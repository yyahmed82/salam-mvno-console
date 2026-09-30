#!/usr/bin/env bash
# jar-release-diff.sh — WHAT CHANGED between two DMS releases, at class level, from the jars alone (30 Sep 2026).
#
# The vendor ships Spring Boot jars, not source. This compares OLD vs NEW exactly (bytecode hashes: no guessing which
# classes moved), decompiles only the classes that differ (CFR), and writes one report per service:
#   REPORT.md      — jar hashes, classes added / changed / removed, library upgrades, config & resource diffs (secrets
#                    masked), then the decompiled source diff of every changed class
#   changes.diff   — the unified diff of the decompiled Java (old → new) for the changed / added / removed classes
#   src/old, src/new — the decompiled Java of those classes, kept for reading side by side
#
# USAGE (on 152 as root — java at /opt/java, CFR beside this script in tools/cfr.jar):
#   bash jar-release-diff.sh <old.jar> <new.jar> [--out DIR]                one service
#   bash jar-release-diff.sh <old-snapshot-dir> <new-snapshot-dir> [--out DIR]
#         two directories of jars (e.g. /apps/unified/snapshots/2026-09-17 and …/2026-09-30): services are paired by
#         name with the version stripped (dms-reports-service-1.2.0.jar ↔ dms-reports-service-1.2.1.jar); unpaired = new / retired
#   bash jar-release-diff.sh --fetch <host> [<host>…]                        pull the live jars from the APP nodes into
#         /apps/unified/snapshots/<today>/<host>/ over the console_ro SSH identity (read-only; same key as the log collector)
#
# STRICTLY READ-ONLY on the DMS side. Writes only under --out (default /apps/unified/snapshots/diffs/<stamp>/).
set -euo pipefail
JAVA="${JAVA:-$( [ -x /opt/java/bin/java ] && echo /opt/java/bin/java || command -v java )}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CFR="${CFR:-$HERE/tools/cfr.jar}"
OUT=""; ARGS=()
while [ $# -gt 0 ]; do case "$1" in --out) OUT="$2"; shift 2;; *) ARGS+=("$1"); shift;; esac; done
set -- "${ARGS[@]}"
[ -x "$JAVA" ] || { echo "✗ java not found (set JAVA=/path/to/java)"; exit 2; }
STAMP="$(date +%Y-%m-%d_%H%M)"

# ---------------------------------------------------------------- --fetch: live jars from the APP nodes (read-only scp)
if [ "${1:-}" = "--fetch" ]; then
  shift; [ $# -gt 0 ] || { echo "✗ --fetch needs at least one host"; exit 2; }
  USER="${DMSLOG_SSH_USER:-console_ro}"; KEY="${DMSLOG_SSH_KEY:-/root/.ssh/api_log_ed25519}"
  DEST="${OUT:-/apps/unified/snapshots/$(date +%Y-%m-%d)}"
  for h in "$@"; do
    mkdir -p "$DEST/$h"
    echo "▸ $h → $DEST/$h"
    # one listing first (what runs, which jar each service points at), then the jars themselves
    ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$USER@$h" \
      'for d in /opt/application/*/; do s=$(basename "$d"); for j in "$d"*.jar "$d"target/*.jar "$d"lib/*.jar; do [ -f "$j" ] && printf "%s\t%s\t%s\t%s\n" "$s" "$(stat -c %Y "$j")" "$(stat -c %s "$j")" "$j"; done; done 2>/dev/null; exit 0' \
      > "$DEST/$h/jars.tsv" || { echo "  ✗ cannot list /opt/application on $h (console_ro access?)"; continue; }
    while IFS=$'\t' read -r svc mtime size path; do
      [ -n "$path" ] || continue
      mkdir -p "$DEST/$h/$svc"
      scp -q -i "$KEY" -o BatchMode=yes "$USER@$h:$path" "$DEST/$h/$svc/" && printf "  %-40s %s  %6.1f MB  %s\n" "$svc" "$(date -d @"$mtime" +%F\ %H:%M)" "$(echo "$size/1048576" | bc -l)" "$(basename "$path")"
    done < "$DEST/$h/jars.tsv"
  done
  echo "DONE → $DEST   (next: bash $0 <previous snapshot dir> $DEST)"; exit 0
fi

[ $# -eq 2 ] || { sed -n 2,20p "$0"; exit 2; }
OLD="$1"; NEW="$2"
[ -f "$CFR" ] || { echo "✗ CFR not found at $CFR (deploy ships it to server/tools/cfr.jar)"; exit 2; }
OUT="${OUT:-/apps/unified/snapshots/diffs/$STAMP}"; mkdir -p "$OUT"

mask() { sed -E 's/((password|passwd|secret|token|api[-_.]?key|private[-_.]?key|credential)[^=:]*[=:][[:space:]]*)[^[:space:]]+/\1***/Ig'; }
# service key = jar name without version; a flat baseline pulled as "<service-dir>__<jar>" (30 Sep 2026 pull) pairs with "<service-dir>/<jar>"
svcname() { basename "$1" .jar | sed -E 's/^.*__//' | sed -E 's/[-_.]?[0-9]+(\.[0-9]+)*(-SNAPSHOT|-RELEASE)?(\.jar)?$//'; }
ver() { basename "$1" .jar | grep -oE '[0-9]+(\.[0-9]+)+(-SNAPSHOT|-RELEASE)?' | tail -1; }

# ---------------------------------------------------------------- one service: old.jar vs new.jar
diff_one() {
  local old="$1" new="$2" name="$3" dir="$4"
  set +e +o pipefail          # diff / grep / cmp return 1 for "differs" — that is the point here, not an error
  mkdir -p "$dir"; local W; W="$(mktemp -d)"
  mkdir -p "$W/old" "$W/new"
  unzip -qo "$old" -d "$W/old"; unzip -qo "$new" -d "$W/new"
  # application classes live in BOOT-INF/classes (Spring Boot) or at the root (plain jar)
  local cro="$W/old/BOOT-INF/classes" crn="$W/new/BOOT-INF/classes"
  [ -d "$cro" ] || cro="$W/old"; [ -d "$crn" ] || crn="$W/new"
  ( cd "$cro" && find . -name '*.class' -type f -print0 | xargs -0 sha256sum | sed 's# \./# #' | sort -k2 ) > "$W/old.classes"
  ( cd "$crn" && find . -name '*.class' -type f -print0 | xargs -0 sha256sum | sed 's# \./# #' | sort -k2 ) > "$W/new.classes"
  join -1 2 -2 2 -a 1 -a 2 -e MISSING -o 0,1.1,2.1 "$W/old.classes" "$W/new.classes" > "$W/classes.join"
  awk '$2=="MISSING"{print $1}' "$W/classes.join" > "$W/added";   awk '$3=="MISSING"{print $1}' "$W/classes.join" > "$W/removed"
  awk '$2!="MISSING" && $3!="MISSING" && $2!=$3{print $1}' "$W/classes.join" > "$W/changed"
  local nA nR nC nT; nA=$(wc -l < "$W/added"); nR=$(wc -l < "$W/removed"); nC=$(wc -l < "$W/changed"); nT=$(wc -l < "$W/new.classes")
  # libraries
  ls "$W/old/BOOT-INF/lib" 2>/dev/null | sort > "$W/old.libs" || true; ls "$W/new/BOOT-INF/lib" 2>/dev/null | sort > "$W/new.libs" || true
  # resources (everything that is not a class): properties, yml, xml, sql, html, wsdl, xsd, txt …
  ( cd "$cro" && find . -type f ! -name '*.class' | sort ) > "$W/old.res"; ( cd "$crn" && find . -type f ! -name '*.class' | sort ) > "$W/new.res"
  {
    echo "# $name — release diff"
    echo; echo "| | OLD | NEW |"; echo "|---|---|---|"
    echo "| jar | \`$(basename "$old")\` | \`$(basename "$new")\` |"
    echo "| version | $(ver "$old") | $(ver "$new") |"
    echo "| sha256 | \`$(sha256sum "$old" | cut -c1-16)…\` | \`$(sha256sum "$new" | cut -c1-16)…\` |"
    echo "| size | $(stat -c %s "$old") B | $(stat -c %s "$new") B |"
    echo "| jar mtime | $(date -r "$old" +'%F %H:%M') | $(date -r "$new" +'%F %H:%M') |"
    echo "| Build-Jdk / Spring Boot | $(grep -hE '^(Build-Jdk|Spring-Boot-Version)' "$W/old/META-INF/MANIFEST.MF" 2>/dev/null | tr '\n' ' ') | $(grep -hE '^(Build-Jdk|Spring-Boot-Version)' "$W/new/META-INF/MANIFEST.MF" 2>/dev/null | tr '\n' ' ') |"
    echo "| application classes | $(wc -l < "$W/old.classes") | $nT |"
    echo; echo "## Classes — **$nC changed · $nA added · $nR removed** (bytecode hash, exact)"
    if [ $((nA+nR+nC)) -eq 0 ]; then echo; echo "No application class differs: same code, only packaging / libraries / resources can differ (see below)."; fi
    [ "$nC" -gt 0 ] && { echo; echo "### Changed"; sed 's#\.class$##; s#/#.#g; s#^#- #' "$W/changed"; }
    [ "$nA" -gt 0 ] && { echo; echo "### Added"; sed 's#\.class$##; s#/#.#g; s#^#- #' "$W/added"; }
    [ "$nR" -gt 0 ] && { echo; echo "### Removed"; sed 's#\.class$##; s#/#.#g; s#^#- #' "$W/removed"; }
    echo; echo "## Libraries (BOOT-INF/lib)"
    if diff -q "$W/old.libs" "$W/new.libs" >/dev/null; then echo; echo "unchanged ($(wc -l < "$W/new.libs") jars)"; else
      echo; echo '```diff'; diff "$W/old.libs" "$W/new.libs" | grep -E '^[<>]' | sed 's/^</-/; s/^>/+/'; echo '```'; fi
    echo; echo "## Configuration & resources (secrets masked)"
    local any=0
    for f in $(sort -u "$W/old.res" "$W/new.res"); do
      case "$f" in *.png|*.jpg|*.gif|*.ico|*.ttf|*.woff*|*.jar) continue;; esac
      if [ ! -f "$cro/$f" ]; then echo; echo "### + $f (new file)"; any=1
      elif [ ! -f "$crn/$f" ]; then echo; echo "### − $f (removed)"; any=1
      elif ! cmp -s "$cro/$f" "$crn/$f"; then any=1; echo; echo "### ~ $f"; echo '```diff'
        diff -u <(mask < "$cro/$f") <(mask < "$crn/$f") | tail -n +3 | head -200; echo '```'; fi
    done
    [ $any -eq 0 ] && { echo; echo "no resource / configuration file differs"; }
    if ! cmp -s "$W/old/META-INF/MANIFEST.MF" "$W/new/META-INF/MANIFEST.MF" 2>/dev/null; then echo; echo "### ~ META-INF/MANIFEST.MF"; echo '```diff'; diff -u "$W/old/META-INF/MANIFEST.MF" "$W/new/META-INF/MANIFEST.MF" | tail -n +3; echo '```'; fi
  } > "$dir/REPORT.md"
  # ---- decompile ONLY what differs (CFR), then diff the Java
  if [ $((nA+nR+nC)) -gt 0 ]; then
    mkdir -p "$dir/src/old" "$dir/src/new"
    decomp() { # $1 class root, $2 list file, $3 out dir
      local root="$1" list="$2" out="$3"; [ -s "$list" ] || return 0
      # inner classes ride with their outer class: decompile the outer, CFR folds the $inner ones in
      sed -E 's/\$[^/]*\.class$/.class/' "$list" | sort -u | while read -r c; do [ -f "$root/$c" ] && echo "$root/$c"; done > "$out.list"
      [ -s "$out.list" ] && "$JAVA" -jar "$CFR" $(cat "$out.list") --outputdir "$out" --silent true --comments false --showversion false >/dev/null 2>&1 || true
    }
    cat "$W/changed" "$W/removed" > "$W/old.list"; cat "$W/changed" "$W/added" > "$W/new.list"
    decomp "$cro" "$W/old.list" "$dir/src/old"; decomp "$crn" "$W/new.list" "$dir/src/new"
    # secrets in string constants are masked in the kept copies too
    find "$dir/src" -name '*.java' -type f -exec sed -i -E 's/((password|passwd|secret|token|api[-_.]?key)[^"]*"[^"]*"[[:space:]]*,?[[:space:]]*")[^"]{4,}"/\1***"/Ig' {} +
    # --show-function-line: every hunk header names the enclosing method (Java declarations are indented, so -p alone would not)
    diff -ruN --show-function-line='^[[:space:]]*\(public\|private\|protected\|static\|final\)[^=;]*(' "$dir/src/old" "$dir/src/new" > "$dir/changes.diff" || true
    {
      echo; echo "## Decompiled source diff (CFR $("$JAVA" -jar "$CFR" --version 2>/dev/null | grep -m1 '^CFR' | awk '{print $2}'))"
      echo; echo "$(grep -c '^+++ ' "$dir/changes.diff") file(s) · +$(grep -cE '^\+[^+]' "$dir/changes.diff") / −$(grep -cE '^-[^-]' "$dir/changes.diff") lines · full text in \`changes.diff\`, sources in \`src/old\` and \`src/new\`"
      echo; echo "| class | +lines | −lines | methods touched |"; echo "|---|---|---|---|"
      # enclosing method per hunk: walk back from the hunk's first line in the NEW (or OLD, for removed classes) source
      awk -v S="$dir/src" '
        function load(path,   l){ nl=0; while((getline l < path)>0) src[++nl]=l; close(path) }
        function methodAt(ln,   k,x,n,w){ for(k=ln;k>=1;k--){ x=src[k]; if(x ~ /^[[:space:]]*(public|private|protected|static|final|synchronized|abstract)[^=;]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*\([^)]*\)[[:space:]]*(throws[^{]*)?\{/){ sub(/\(.*/,"",x); n=split(x,w,/[[:space:]]+/); return w[n] } if(x ~ /^(public|final|abstract)?[[:space:]]*(class|interface|enum) /) return "" } return "" }
        function flush(){ if(f) printf "| %s | %d | %d | %s |\n", f, a, d, m }
        /^\+\+\+ /{ flush(); f=$2; sub(/.*src\/new\//,"",f); a=0; d=0; m=""; side="new"; if($2 ~ /\/dev\/null$/ || $0 ~ /1970-01-01/){ side="old" } load(S "/" side "/" f) }
        /^--- /{ o=$2; sub(/.*src\/old\//,"",o) }
        /^@@ /{ h=$0; if(side=="new"){ sub(/^@@ -[0-9,]+ \+/,"",h) } else { sub(/^@@ -/,"",h) } sub(/[ ,].*/,"",h); ln=h-1; next }
        /^\+[^+]/{ a++; if(side=="new") ln++; x=methodAt(ln); if(x!="" && index(m, x)==0) m=m (m?", ":"") x; next }
        /^-[^-]/{ d++; if(side=="old") ln++; x=methodAt(side=="new"?ln+1:ln); if(x!="" && index(m, x)==0) m=m (m?", ":"") x; next }
        /^ /{ ln++ }
        END{ flush() }' "$dir/changes.diff"
      echo; echo '```diff'; head -c 200000 "$dir/changes.diff"; echo '```'
    } >> "$dir/REPORT.md"
  fi
  rm -rf "$W"; set -e -o pipefail
  printf "  %-42s classes %3d changed %3d added %3d removed  → %s\n" "$name" "$nC" "$nA" "$nR" "$dir/REPORT.md"
}

# ---------------------------------------------------------------- pair jars (two files, or two snapshot trees)
if [ -f "$OLD" ] && [ -f "$NEW" ]; then
  diff_one "$OLD" "$NEW" "$(svcname "$NEW")" "$OUT/$(svcname "$NEW")_$(ver "$OLD")_vs_$(ver "$NEW")"
else
  [ -d "$OLD" ] && [ -d "$NEW" ] || { echo "✗ give two jars or two directories"; exit 2; }
  echo "▸ pairing services: $OLD ↔ $NEW"
  declare -A O N
  while IFS= read -r j; do O["$(svcname "$j")"]="$j"; done < <(find "$OLD" -name '*.jar' -type f ! -path '*/BOOT-INF/*' ! -path '*/lib/*')
  while IFS= read -r j; do N["$(svcname "$j")"]="$j"; done < <(find "$NEW" -name '*.jar' -type f ! -path '*/BOOT-INF/*' ! -path '*/lib/*')
  [ ${#O[@]} -gt 0 ] || { echo "✗ no jars found under $OLD — wrong path or the fetch failed"; exit 3; }
  [ ${#N[@]} -gt 0 ] || { echo "✗ no jars found under $NEW — the --fetch failed (see ✗ lines above); nothing compared"; exit 3; }
  { echo "# Release diff $STAMP"; echo; echo "OLD: \`$OLD\`  ·  NEW: \`$NEW\`"; echo; echo "| service | old | new | classes changed | added | removed | verdict |"; echo "|---|---|---|---|---|---|---|"; } > "$OUT/INDEX.md"
  for s in $(printf '%s\n' "${!O[@]}" "${!N[@]}" | sort -u); do
    if [ -z "${O[$s]:-}" ]; then echo "| $s | — | $(basename "${N[$s]}") | | | | **new service** |" >> "$OUT/INDEX.md"; continue; fi
    if [ -z "${N[$s]:-}" ]; then echo "| $s | $(basename "${O[$s]}") | — | | | | **retired** |" >> "$OUT/INDEX.md"; continue; fi
    if cmp -s "${O[$s]}" "${N[$s]}"; then echo "| $s | $(basename "${O[$s]}") | $(basename "${N[$s]}") | 0 | 0 | 0 | identical jar |" >> "$OUT/INDEX.md"; printf "  %-42s identical\n" "$s"; continue; fi
    d="$OUT/${s}_$(ver "${O[$s]}")_vs_$(ver "${N[$s]}")"
    diff_one "${O[$s]}" "${N[$s]}" "$s" "$d"
    read -r c a r < <(awk -F'[·*]+' '/^## Classes/{gsub(/[^0-9 ]/,"",$0); print}' "$d/REPORT.md")
    echo "| $s | $(basename "${O[$s]}") | $(basename "${N[$s]}") | ${c:-0} | ${a:-0} | ${r:-0} | [report](./$(basename "$d")/REPORT.md) |" >> "$OUT/INDEX.md"
  done
  echo "INDEX → $OUT/INDEX.md"
fi
