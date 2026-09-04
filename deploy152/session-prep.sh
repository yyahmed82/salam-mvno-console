#!/usr/bin/env bash
# L2 review — facilitator pre-session check + live examples, in one run.
#
#   scp mvno-console/deploy152/session-prep.sh yosri@172.31.38.152:
#   ssh yosri@172.31.38.152  →  sudo su -  →  bash /home/yosri/session-prep.sh
#
# Produces everything module 1.3 needs: one REAL order reference per flow state, pulled from
# today's data minutes before the session — because a scenario dies the moment an example
# returns "not found".
set -uo pipefail
PORT="${PORT:-4600}"
H='X-Console-User: y.yahmed.sns@salam.sa'
B="http://127.0.0.1:$PORT"

bold(){ printf '\n\033[1m%s\033[0m\n%s\n' "$1" "$(printf '─%.0s' $(seq ${#1}))"; }
say(){ printf '  %s\n' "$1"; }

bold "1 · platform health (abort the session prep if this fails)"
cd /apps/console/server && set -a; . ../.env; set +a
node /apps/console/server/postdeploy-check.cjs >/tmp/prep-check.txt 2>&1
tail -3 /tmp/prep-check.txt
grep -q "deploy verified" /tmp/prep-check.txt || { echo "  ✗ NOT healthy — fix before presenting. Full output: /tmp/prep-check.txt"; }

bold "2 · data freshness right now (quote these numbers in module 1.2)"
curl -s -H "$H" "$B/api/health" >/dev/null
for t in payments onboarding_orders activation_logs; do
  node -e "
    const {Client}=require('pg');
    (async()=>{ const c=new Client({connectionString:process.env.SOURCE_DATABASE_URL,options:'-c timezone=UTC'});
      await c.connect(); const r=await c.query('SELECT max(created_at) m FROM $t');
      const lag=Math.round((Date.now()-new Date(r.rows[0].m))/60000);
      console.log('  $t: newest row', lag, 'min old'); await c.end(); })();"
done

bold "3 · live examples for module 1.3 — write these on a card / second screen"
for pair in \
  "pay_pending:PENDING payment (is it stuck or abandoned? walk the definition)" \
  "pay_fail:FAILED payment (read the decline reason together)" \
  "not_assigned:NOT ASSIGNED physical SIM (our own courier backlog)" \
  "courier_not_created:COURIER NOT CREATED (paid reseller order, no delivery request — dispatch backlog)" \
  "shop_pickup:SHOP PICKUP (reseller, apollo_require_delivery=false — collected in-shop)" \
  "esim_not_activated:eSIM paid but not activated" \
  "delivered:DELIVERED awaiting activation"; do
  node="${pair%%:*}"; label="${pair#*:}"
  echo ""
  echo "  ── $label"
  for lane in newsim mnp; do
    out=$(curl -s -H "$H" "$B/api/onboarding-flow/orders?lane=$lane&node=$node" \
      | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except: sys.exit()
rows=d.get('rows',[])[:2]
for r in rows:
    ch=(' · '+r['channel']) if r.get('channel') else ''
    print(f\"     {('$lane').upper():6} {r['id']}  {r.get('state','')}{ch}  {str(r.get('at',''))[:16]}\")
if not rows: print('     ${lane}: (none in window — widen the range in the UI)')" )
    echo "$out"
  done
done

bold "4 · the OSB exhibit for module 1.5 (coverage) — first-ever read-path view"
curl -s -H "$H" "$B/api/osb/faults?minutes=1440" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if not d.get('ok'): print('  feed not answering:', d.get('error')); sys.exit()
print(f\"  {d['total']} read-path 1500 faults in 24h · peak {d['peakPerMin']}/min\")
for a in d.get('byApi',[])[:4]: print(f\"    {a['count']:>5}  {a['api']}\")
print('  → show this live: this data was INVISIBLE to us until this week.')"

bold "5 · reconciliation spot-check (the module-1.3 opener)"
curl -s -H "$H" "$B/api/onboarding-flow" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for l in d.get('lanes',[]):
    n=l['nodes']
    phys=n.get('physical',0); a=n.get('assigned',0); na=n.get('not_assigned',0); cnc=n.get('courier_not_created',0); sp=n.get('shop_pickup',0)
    ok='✓' if phys==a+na+cnc+sp else '✗ MISMATCH'
    print(f\"  {l['label']:8} physical {phys} = assigned {a} + not_assigned {na} + courier_not_created {cnc} + shop_pickup {sp}   {ok}\")
    if l.get('partners'): print('           partner split:', ', '.join(f'{k}:{v}' for k,v in l['partners'].items()))
print('  → open with this: the tree reconciles to the Orders KPI, and here is the arithmetic.')"

bold "done"
say "If every section above looks right, the platform half of the prep is finished."
say "Remaining prep is people: accounts, Teams links, printed sign-off sheets. See the checklist."
