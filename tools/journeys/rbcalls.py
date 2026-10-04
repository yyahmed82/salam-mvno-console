#!/usr/bin/env python3
"""Static call graph of the Digital selfcare backend (Rails) → BSS gateway calls (base /api/uil).

For every Mobile › Journeys step (controller#action, services, async worker) it computes the
downstream BSS gateway paths the code reaches, with the chain that reaches them, and for every
gateway path the entry points (controller actions, workers, model hooks) that call it.

Resolution rules (conservative — an edge exists only when the receiver class is known):
  · Cls.new(...).m / Cls.new_from_x(...).m / Cls.m (class method)          → Cls#m
  · v = Cls.new… ; v.m   ·   @v ||= Cls.new… (memo helper) ; helper.m       → Cls#m
  · XWorker.perform_async/perform_in/perform_at                            → XWorker#perform (async)
  · bare m / self.m inside a class (own methods, parents, included concerns)
  · before_action / skip_before_action (only:/except:) on controllers
  · model hooks: before/after_(create|save|destroy|update|commit) + has_one/has_many/belongs_to
    receivers (order.number.destroy → Number#~destroy → before_destroy callbacks)
  · AASM events (event :e, after/after_commit/before/success: cb, `after do … end`) → Cls#e / e!
  · unique-name fallback: recv.m with unknown receiver, when m (≥ 8 chars, not generic) is
    defined in exactly one class → edge flagged weak
Comments (# …, =begin/=end) are stripped before matching.
"""
import os, re, json, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
if len(sys.argv) < 2:
    sys.exit('usage: python3 tools/journeys/rbcalls.py <selfcare-backend>/app [data2.js|journeys.json] [journeyDownstream.js]')
APP = sys.argv[1]
JOURNEYS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, 'data2.js')
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(REPO, 'journeyDownstream.js')
BSS_NS = 'Optiva'          # Rails module of the BSS adapter (base_uri …/api/uil)
SHOW_NS = 'Oracle'         # how Mobile › Journeys names it

# ---------------------------------------------------------------- parsing
def strip_comment(line):
    out = []; q = None; i = 0
    while i < len(line):
        c = line[i]
        if q:
            out.append(c)
            if c == '\\' and i + 1 < len(line): out.append(line[i + 1]); i += 2; continue
            if c == q: q = None
        else:
            if c in '"\'': q = c; out.append(c)
            elif c == '#': break
            else: out.append(c)
        i += 1
    return ''.join(out).rstrip()

class Meth:
    __slots__ = ('cls', 'name', 'static', 'file', 'line', 'body', 'public', 'kind')
    def __init__(s, cls, name, static, file, line, public, kind='def'):
        s.cls, s.name, s.static, s.file, s.line, s.public, s.kind = cls, name, static, file, line, public, kind
        s.body = []
    @property
    def key(s): return f"{s.cls}{'.' if s.static else '#'}{s.name}"

class Klass:
    def __init__(s, name, file):
        s.name, s.file = name, file
        s.parent = None; s.includes = []; s.consts = {}; s.classlines = []; s.methods = {}; s.smethods = {}
        s.assoc = {}; s.queue = None

KL = {}
def kget(name, file):
    if name not in KL: KL[name] = Klass(name, file)
    return KL[name]

RX_OPEN = re.compile(r'^(\s*)(module|class)\s+([A-Z][\w:]*)(?:\s*<\s*([A-Z][\w:]*))?')
RX_DEF = re.compile(r'^(\s*)def\s+(self\.)?([a-z_]\w*[!?=]?)')
RX_END = re.compile(r'^(\s*)end\b')
RX_BLOCKOPEN = re.compile(r'(\bdo\b(\s*\|[^|]*\|)?\s*$)|^\s*(if|unless|while|until|case|begin|for)\b|=\s*(if|unless|case|begin)\b')

def parse_file(path, rel):
    try: raw = open(path, encoding='utf-8', errors='replace').read().split('\n')
    except Exception: return
    lines = []; inblk = False
    for l in raw:
        if l.startswith('=begin'): inblk = True; lines.append(''); continue
        if l.startswith('=end'): inblk = False; lines.append(''); continue
        lines.append('' if inblk else strip_comment(l))
    stack = []   # (indent, kind, name|Meth)
    for no, l in enumerate(lines, 1):
        if not l.strip(): continue
        ind = len(l) - len(l.lstrip(' '))
        if RX_END.match(l) and stack and ind <= stack[-1][0]:
            while stack and stack[-1][0] > ind: stack.pop()      # an opener we tracked but whose end is dedented
            if stack and stack[-1][0] == ind:
                stack.pop(); continue
        cur_cls = [x for x in stack if x[1] in ('class', 'module')]
        cur_meth = next((x for x in reversed(stack) if x[1] == 'def'), None)
        if cur_meth:
            cur_meth[2].body.append((no, l))
            # nested def inside def (rare) — ignore as separate
            continue
        mo = RX_OPEN.match(l)
        if mo and not l.rstrip().endswith('end'):
            name = mo.group(3)
            outer = '::'.join(x[2] for x in cur_cls)
            full = name if (name.count('::') and not outer) else (outer + '::' + name if outer else name)
            k = kget(full, rel)
            if mo.group(4): k.parent = mo.group(4)
            stack.append((ind, mo.group(2), name, full, {'public': True}))
            continue
        md = RX_DEF.match(l)
        if md and cur_cls:
            k = KL[cur_cls[-1][3]]
            vis = cur_cls[-1][4]
            mm = Meth(k.name, md.group(3), bool(md.group(2)), rel, no, vis['public'] or bool(md.group(2)))
            (k.smethods if mm.static else k.methods)[mm.name] = mm
            one_line = re.search(r'\bend\s*$', l) and (';' in l or re.search(r'def\s+\S+\s*(\([^)]*\))?\s+=', l))
            if one_line or re.search(r'def\s+[\w.!?=]+(\([^)]*\))?\s*=\s*\S', l):
                mm.body.append((no, l)); continue
            mm.body.append((no, l))
            stack.append((ind, 'def', mm))
            continue
        if cur_cls:
            k = KL[cur_cls[-1][3]]
            s = l.strip()
            if s in ('private', 'protected'): cur_cls[-1][4]['public'] = False; continue
            if s == 'public': cur_cls[-1][4]['public'] = True; continue
            k.classlines.append((no, l))
            mc = re.match(r'^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"', l)
            if mc: k.consts[mc.group(1)] = mc.group(2)
            mi = re.match(r'^\s*include\s+([A-Z][\w:]*)', l)
            if mi: k.includes.append(mi.group(1))
            mq = re.search(r'sidekiq_options\b.*\bqueue:\s*[:"\']?([\w-]+)', l)
            if mq: k.queue = mq.group(1)
            ma = re.match(r'^\s*(has_one|has_many|belongs_to)\s+:(\w+)(.*)', l)
            if ma:
                cn = re.search(r'class_name:\s*["\']([\w:]+)["\']', ma.group(3))
                nm = ma.group(2)
                cls = cn.group(1) if cn else ''.join(p.capitalize() for p in (nm[:-1] if ma.group(1) == 'has_many' and nm.endswith('s') else nm).split('_'))
                k.assoc[nm] = cls
            # opening a block at class level (aasm do / event do / included do / scope …) — track so its `end` pops
            if RX_BLOCKOPEN.search(l) and not re.search(r'\bend\s*$', l):
                stack.append((ind, 'blk', None))
            continue
        if RX_BLOCKOPEN.search(l) and not re.search(r'\bend\s*$', l):
            stack.append((ind, 'blk', None))

for dp, dn, fn in sorted(os.walk(APP)):
    dn.sort()
    for f in sorted(fn):
        if f.endswith('.rb'):
            p = os.path.join(dp, f); parse_file(p, os.path.relpath(p, os.path.dirname(APP)))

# ---------------------------------------------------------------- name resolution
ALLM = collections.defaultdict(list)   # instance method name → [Meth]
for k in KL.values():
    for m in k.methods.values(): ALLM[m.name].append(m)

def resolve_const(name, ctx):
    """Resolve a constant reference as Ruby would (lexical namespaces of ctx, then top level)."""
    if name.startswith('::'): name = name[2:]
    parts = ctx.split('::') if ctx else []
    for i in range(len(parts), -1, -1):
        cand = '::'.join(parts[:i] + [name]) if i else name
        if cand in KL: return cand
    return None

def ancestors(cname, seen=None):
    seen = seen or set()
    if not cname or cname in seen or cname not in KL: return []
    seen.add(cname); k = KL[cname]; out = [cname]
    for inc in k.includes:
        r = resolve_const(inc, cname)
        if r: out += ancestors(r, seen)
    if k.parent:
        r = resolve_const(k.parent, '::'.join(cname.split('::')[:-1]))
        if r: out += ancestors(r, seen)
    return out

def find_method(cname, mname, static=False):
    for a in ancestors(cname):
        d = KL[a].smethods if static else KL[a].methods
        if mname in d: return d[mname]
    return None

GENERIC = set('''new create update destroy save show index edit call perform initialize valid? present? blank? to_s to_h to_json
 as_json each map select find where first last count size send process run execute handle build reload data result response
 body status params request token value values keys success? error errors message parse call! save! update! destroy! create!
 delete get post put patch log info debug warn find_by update_columns update_column update_attribute assign_attributes'''.split())

# ---------------------------------------------------------------- per-method edges
GATEWAY = {}     # method key → [path]
EDGES = collections.defaultdict(list)   # method key → [(target key, kind)]  kind: sync|async:<queue>|hook|weak
METH = {}

def mkey(m): return m.key

def gw_paths(m, k):
    out = []
    for _, l in m.body:
        for mm in re.finditer(r'(?:\bpath\s*=\s*|send_\w*request\w*\(\s*)"([^"]+)"', l):
            s = mm.group(1)
            def rep(x):
                v = x.group(1).strip()
                for a in ancestors(k.name):
                    if v in KL[a].consts: return KL[a].consts[v]
                return ':' + re.sub(r'\W+', '_', v).strip('_')
            s = re.sub(r'#\{([^}]*)\}', rep, s)
            if s.startswith('/'): out.append(s)
    return out

def method_returns(m, k):
    """memo helper `def client; @client ||= Cls.new; end` → Cls"""
    txt = ' '.join(l for _, l in m.body[1:]) if len(m.body) > 1 else m.body[0][1]
    mm = re.search(r'(?:@\w+\s*\|\|=\s*|^\s*|=\s*)([A-Z][\w:]*)\.new\w*\b', txt)
    if mm and len(m.body) <= 4: return resolve_const(mm.group(1), k.name)
    return None

RET = {}
for k in KL.values():
    for m in k.methods.values():
        r = method_returns(m, k)
        if r: RET[(k.name, m.name)] = r

HOOK_VERBS = {'destroy': 'destroy', 'destroy!': 'destroy', 'destroy_all': 'destroy', 'create': 'create', 'create!': 'create',
              'save': 'save', 'save!': 'save', 'update': 'save', 'update!': 'save'}

def scan_calls(m, k, lines):
    """edges from code lines (method body or a class-level block) of method m in class k"""
    ctx = k.name
    typed = {}
    txt_lines = [l for _, l in lines]
    # typed locals / ivars
    for l in txt_lines:
        for mm in re.finditer(r'(@{0,2}\w+)\s*(?:\|\|)?=\s*([A-Z][\w:]*)\.(new\w*|from_\w+|find\w*|where|create!?)\b', l):
            r = resolve_const(mm.group(2), ctx)
            if r: typed[mm.group(1)] = r
    # ivars typed elsewhere in the class or its parents (set in before_action helpers etc.)
    for a in ancestors(ctx):
        for mm2 in KL[a].methods.values():
            for _, l in mm2.body:
                for mm in re.finditer(r'(@\w+)\s*(?:\|\|)?=\s*([A-Z][\w:]*)\.(new\w*|from_\w+|find\w*|where)\b', l):
                    r = resolve_const(mm.group(2), a)
                    if r and mm.group(1) not in typed: typed[mm.group(1)] = r
    out = []
    own = set()
    for a in ancestors(ctx):
        own |= set(KL[a].methods)
    for l in txt_lines:
        # Worker.perform_async
        for mm in re.finditer(r'([A-Z][\w:]*Worker|[A-Z][\w:]*(?:Post|Pre))(?:\.set\([^)]*\))?\.perform_(?:async|in|at)\b', l):
            r = resolve_const(mm.group(1), ctx)
            if r and find_method(r, 'perform'): out.append((find_method(r, 'perform').key, 'async:' + (KL[r].queue or 'default')))
        # Cls(.new…(...))?.meth
        for mm in re.finditer(r'(?<![\w:@.])([A-Z][\w]*(?:::[A-Z]\w*)*)((?:\.new\w*|\.from_\w+)(?:\([^()]*(?:\([^()]*\)[^()]*)*\))?)?\.([a-z_]\w*[!?]?)', l):
            r = resolve_const(mm.group(1), ctx)
            if not r: continue
            meth = mm.group(3)
            if meth.startswith('perform_'): continue
            if mm.group(2):
                t = find_method(r, meth)
                if t: out.append((t.key, 'sync'))
                elif meth in HOOK_VERBS: out.append((f'{r}#~{HOOK_VERBS[meth]}', 'hook'))
            else:
                t = find_method(r, meth, static=True)
                if t: out.append((t.key, 'sync'))
                elif meth in ('create', 'create!'): out.append((f'{r}#~create', 'hook')); out.append((f'{r}#~save', 'hook'))
                elif meth.startswith('new') and find_method(r, 'initialize'): out.append((find_method(r, 'initialize').key, 'sync'))
        # typed receiver .meth   (v.meth / @v.meth / helper.meth)
        for mm in re.finditer(r'(?<![\w.:])(@{0,2}[a-z_]\w*)\.([a-z_]\w*[!?]?)', l):
            recv, meth = mm.group(1), mm.group(2)
            r = typed.get(recv) or RET.get((ctx, recv)) or next((RET[(a, recv)] for a in ancestors(ctx) if (a, recv) in RET), None)
            if not r:   # Rails naming convention: @onboarding_order / number / checkout → OnboardingOrder / Number / Checkout (models only)
                cn = ''.join(x.capitalize() for x in recv.lstrip('@').split('_'))
                if cn in KL and KL[cn].file.startswith('app/models'): r = cn
            if not r and recv.lstrip('@') in KL[ctx].assoc:   # self association used bare: number.destroy
                r = resolve_const(KL[ctx].assoc[recv.lstrip('@')], '')
            if r:
                t = find_method(r, meth)
                if t: out.append((t.key, 'sync')); continue
                if meth in HOOK_VERBS: out.append((f'{r}#~{HOOK_VERBS[meth]}', 'hook')); continue
                ev = aasm_event(r, meth)
                if ev: out.append((ev, 'sync')); continue
                continue
            # association chain …​.assoc.meth   (order.number.destroy, @onboarding_order.numbers.create)
        for mm in re.finditer(r'\.([a-z_]\w*)\.([a-z_]\w*[!?]?)', l):
            assoc, meth = mm.group(1), mm.group(2)
            cands = {resolve_const(kk.assoc[assoc], '') for kk in KL.values() if assoc in kk.assoc}
            cands.discard(None)
            if len(cands) == 1:
                r = cands.pop()
                t = find_method(r, meth)
                if t: out.append((t.key, 'sync'))
                elif meth in HOOK_VERBS: out.append((f'{r}#~{HOOK_VERBS[meth]}', 'hook'))
                else:
                    ev = aasm_event(r, meth)
                    if ev: out.append((ev, 'sync'))
        # bare / self. calls to own methods (and own aasm events)
        for mm in re.finditer(r'(?<![\w.:@])(?:self\.)?([a-z_]\w*[!?]?)(?=\s*[\(\s]|$|\)|,)', l):
            nm = mm.group(1)
            if nm in own and nm != m.name:
                t = find_method(ctx, nm)
                if t: out.append((t.key, 'sync'))
            else:
                ev = aasm_event(ctx, nm)
                if ev: out.append((ev, 'sync'))
        # weak unique-name fallback: recv.meth, receiver unknown
        for mm in re.finditer(r'(?<=[\w)\]])\.([a-z_]\w*[!?]?)', l):
            meth = mm.group(1)
            if len(meth) < 8 or meth in GENERIC or meth.startswith(('perform_', 'new')): continue
            c = ALLM.get(meth, [])
            if len(c) == 1 and not c[0].cls.startswith('Api::'):
                out.append((c[0].key, 'weak'))
        # self.class / hooks via save in own class
        if re.search(r'(?<![\w.])(?:self\.)?(save!?|update!?)\b(?!_)', l) and is_model(ctx):
            out.append((f'{ctx}#~save', 'hook'))
        if re.search(r'(?<![\w.])(?:self\.)?destroy!?\b(?!_)', l) and is_model(ctx):
            out.append((f'{ctx}#~destroy', 'hook'))
    return out

def is_model(cname): return any(KL[a].file.startswith('app/models') for a in ancestors(cname)[:1])

# AASM events: pseudo methods Cls#event / event!
AASM = collections.defaultdict(dict)   # cls → event → Meth(pseudo)
def build_aasm():
    for k in KL.values():
        cl = k.classlines
        for i, (no, l) in enumerate(cl):
            me = re.match(r'^(\s*)event\s+:(\w+)(.*)', l)
            if me:
                ev = Meth(k.name, me.group(2), False, k.file, no, True, 'aasm')
                body = [(no, l)]
                ind = len(me.group(1))
                for no2, l2 in cl[i + 1:]:
                    if RX_END.match(l2) and len(l2) - len(l2.lstrip()) == ind: break
                    body.append((no2, l2))
                ev.body = body
                AASM[k.name][me.group(2)] = ev
            ma = re.match(r'^\s*after_all_transitions\s+:(\w+)', l)
            if ma: AASM[k.name]['__all__'] = ma.group(1)
build_aasm()

def aasm_event(cname, nm):
    base = nm.rstrip('!')
    for a in ancestors(cname):
        if base in AASM.get(a, {}): return f'{a}#{base}'
    return None

# hooks: model callbacks + controller before_action
HOOKS = collections.defaultdict(list)       # pseudo key Cls#~verb → [callback method name]
BEFORE = collections.defaultdict(list)      # controller cls → [(cb, only, except)]
SKIP = collections.defaultdict(list)
for k in KL.values():
    for no, l in k.classlines:
        mh = re.match(r'^\s*(before|after|around)_(create|save|destroy|update|commit|create_commit|update_commit|destroy_commit)\s+((?::\w+[!?]?\s*,?\s*)+)(.*)', l)
        if mh:
            verb = mh.group(2)
            on = re.search(r'on:\s*\[?\s*:(\w+)', mh.group(4))
            v = {'create': 'create', 'save': 'save', 'destroy': 'destroy', 'update': 'save', 'commit': (on.group(1) if on else 'save'),
                 'create_commit': 'create', 'update_commit': 'save', 'destroy_commit': 'destroy'}[verb]
            if v == 'update': v = 'save'
            for cb in re.findall(r':(\w+[!?]?)', mh.group(3)): HOOKS[f'{k.name}#~{v}'].append(cb)
            if v == 'create': pass
        mb = re.match(r'^\s*(skip_)?before_action\s+((?::\w+[!?]?\s*,?\s*)+)(.*)', l)
        if mb:
            only = re.findall(r':(\w+)', (re.search(r'only:\s*(\[[^\]]*\]|:\w+)', mb.group(3)) or [None, ''])[1] or '')
            exc = re.findall(r':(\w+)', (re.search(r'except:\s*(\[[^\]]*\]|:\w+)', mb.group(3)) or [None, ''])[1] or '')
            for cb in re.findall(r':(\w+[!?]?)', mb.group(2)):
                (SKIP if mb.group(1) else BEFORE)[k.name].append((cb, set(only), set(exc)))

# assemble the graph
NODES = {}
for k in KL.values():
    for m in list(k.methods.values()) + list(k.smethods.values()):
        NODES[m.key] = m
for c, evs in AASM.items():
    for e, ev in evs.items():
        if isinstance(ev, Meth): NODES[f'{c}#{e}'] = ev

for key, m in NODES.items():
    k = KL[m.cls]
    if m.cls.split('::')[0] == BSS_NS:
        p = gw_paths(m, k)
        if p: GATEWAY[key] = p
    lines = m.body if m.kind == 'aasm' else m.body[1:]
    _e = scan_calls(m, k, lines)
    _strong = {t for t, kind in _e if kind != 'weak'}
    EDGES[key] += list(dict.fromkeys((t, kind) for t, kind in _e if kind != 'weak' or t not in _strong))
    if m.kind == 'aasm':
        for cb in re.findall(r'(?:after|before|success|after_commit|after_enter|guard):\s*:(\w+[!?]?)', ' '.join(l for _, l in m.body)):
            t = find_method(m.cls, cb)
            if t: EDGES[key].append((t.key, 'sync'))
        allcb = AASM[m.cls].get('__all__')
        if allcb and find_method(m.cls, allcb): EDGES[key].append((find_method(m.cls, allcb).key, 'sync'))
    # controller actions inherit before_action callbacks
    if m.cls.endswith('Controller') and m.public and not m.static:
        cbs = []
        for a in reversed(ancestors(m.cls)):
            for cb, only, exc in BEFORE.get(a, []):
                if (not only or m.name in only) and m.name not in exc: cbs.append(cb)
            for cb, only, exc in SKIP.get(a, []):
                if (not only or m.name in only) and m.name not in exc: cbs = [x for x in cbs if x != cb]
        for cb in cbs:
            t = find_method(m.cls, cb)
            if t: EDGES[key].append((t.key, 'sync'))
for hk, cbs in HOOKS.items():
    c = hk.split('#')[0]
    for cb in cbs:
        t = find_method(c, cb)
        if t: EDGES[hk].append((t.key, 'sync'))
    NODES.setdefault(hk, None)
# a create also runs save hooks
for hk in list(HOOKS):
    if hk.endswith('#~create'): EDGES[hk].append((hk.replace('#~create', '#~save'), 'hook'))

def show(key): return key.replace(BSS_NS + '::', SHOW_NS + '::')

# ---------------------------------------------------------------- forward closure
def reach(roots, maxd=9):
    """BFS from roots → {path: (leaf, chain, async_queue, weak)} shortest chain per path"""
    best = {}
    seen = {}
    q = collections.deque((r, (r,), None, False) for r in roots)
    while q:
        node, chain, aq, weak = q.popleft()
        if node in seen and seen[node] <= len(chain): continue
        seen[node] = len(chain)
        for p in GATEWAY.get(node, []):
            if p not in best: best[p] = (node, chain, aq, weak)
        if len(chain) > maxd: continue
        for t, kind in EDGES.get(node, []):
            if t in chain: continue
            nq = aq
            if kind.startswith('async:') and not aq: nq = kind[6:]
            q.append((t, chain + (t,), nq, weak or kind == 'weak'))
    return best

# ---------------------------------------------------------------- journey roots
LAST = {'cls': None}
def ctl_roots(ctl, svc, asy):
    roots = []; notes = []
    pieces = re.split(r'\s*(?:·|→|,| / |\+)\s*', ctl or '')
    last_cls = LAST['cls']
    for pc in pieces:
        pc = pc.strip()
        for sub in re.split(r'/(?=#)', pc):
            mm = re.match(r'^([A-Z][\w:()/]*?)?(?:#([\w!?*()]+))?$', sub.strip())
            if not mm: continue
            cls_s, act = mm.group(1), mm.group(2)
            classes = []
            if cls_s:
                alts = re.findall(r'\(([^)]*)\)', cls_s)
                base = re.sub(r'\([^)]*\)', '', cls_s)
                classes = [base]
                for alt in alts:
                    for v in alt.split('/'):
                        classes.append(re.sub(r'(V\d+)(?=::)', v.strip(), base, count=1))
                last_cls = classes; LAST['cls'] = classes
            elif act and last_cls: classes = last_cls
            resolved = []
            for c in classes:
                c = c.replace(SHOW_NS + '::', BSS_NS + '::')
                if c in KL: resolved.append(c)
                else:
                    cand = [n for n in KL if n.endswith('::' + c) or n == c]
                    if len(cand) == 1: resolved.append(cand[0])
                    elif len(cand) > 1:
                        v1 = [n for n in cand if '::V1::' in n]
                        resolved += v1[:1] or cand[:1]
            for c in resolved:
                if act:
                    for a in re.split(r'[()]', act):
                        a = a.strip()
                        if not a or a == '*': continue
                        t = find_method(c, a) or find_method(c, a, True) or (find_method(c, a + '_otp') if False else None)
                        if t: roots.append(t.key)
                        else:
                            ev = aasm_event(c, a)
                            if ev: roots.append(ev)
                else:
                    k = KL[c]
                    if c.endswith('Worker') or find_method(c, 'perform'):
                        t = find_method(c, 'perform')
                        if t: roots.append(t.key)
                    elif c.endswith('Controller'):
                        own = [k] + [KL[r] for r in (resolve_const(i, c) for i in k.includes) if r]
                        roots += [m.key for kk in own for m in kk.methods.values() if m.public]
    for s in svc or []:
        s0 = re.sub(r'\s*\(.*$', '', s).strip()
        for part in re.split(r'[,/]', s0):
            part = part.strip()
            mm = re.match(r'^([A-Z][\w:]*)?(?:[#.]([a-z_]\w*[!?]?))?$', part.replace(SHOW_NS + '::', BSS_NS + '::'))
            if not mm: continue
            c, a = mm.group(1), mm.group(2)
            if c and a:
                r = resolve_const(c, '') or next((n for n in KL if n.endswith('::' + c)), None)
                if r:
                    t = find_method(r, a) or find_method(r, a, True)
                    if t: roots.append(t.key)
                    else:
                        ev = aasm_event(r, a)
                        if ev: roots.append(ev)
            elif a or (not c and part and part[0].islower()):
                nm = a or part
                cands = ALLM.get(nm, [])
                if len(cands) == 1: roots.append(cands[0].key)
                else:
                    sm = [m for k in KL.values() for m in k.smethods.values() if m.name == nm]
                    if len(sm) == 1: roots.append(sm[0].key)
    if asy and asy.get('w'):
        w = asy['w'].replace(SHOW_NS + '::', BSS_NS + '::')
        r = resolve_const(w, '')
        if r and find_method(r, 'perform'): roots.append(find_method(r, 'perform').key)
    return list(dict.fromkeys(roots))

if JOURNEYS.endswith('.js'):   # read the JOURNEYS constant straight from data2.js (node, no build step)
    import subprocess
    js = ("const fs=require('fs'),vm=require('vm');const w={};vm.createContext(w);"
          "vm.runInContext(fs.readFileSync(process.argv[1],'utf8')+';globalThis.__J=JOURNEYS;',w);"
          "process.stdout.write(JSON.stringify(w.__J.map(j=>({id:j.id,steps:j.steps.map((s,i)=>({i,ctl:s.ctl,svc:s.svc||[],async:s.async||null}))}))));")
    J = json.loads(subprocess.check_output(['node', '-e', js, JOURNEYS]))
else:
    J = json.load(open(JOURNEYS))
steps_out = {}
unresolved = []
for j in J:
    LAST['cls'] = None
    for s in j['steps']:
        roots = ctl_roots(s['ctl'], s['svc'], s['async'])
        if not roots:
            unresolved.append((j['id'], s['i'], s['ctl'])); continue
        best = reach(roots)
        rows = []
        for p, (leaf, chain, aq, weak) in sorted(best.items()):
            rows.append({'p': p, 'm': show(leaf), 'via': [show(x) for x in chain[:-1]], 'aq': aq, 'w': bool(weak)})
        if rows: steps_out.setdefault(j['id'], {})[str(s['i'])] = rows

# ---------------------------------------------------------------- reverse index: path → entry points
REV = collections.defaultdict(set)
for a, lst in EDGES.items():
    for b, kind in lst: REV[b].add((a, kind))
def entry_kind(key):
    m = NODES.get(key)
    if key.endswith('#perform'): return 'worker'
    if m is not None and m.cls.endswith('Controller') and m.public and not m.static: return 'action'
    if '#~' in key: return 'hook'
    return None
callers = {}
for leaf, paths in GATEWAY.items():
    found = {}
    q = collections.deque([(leaf, (leaf,), None, False)])
    seen = set()
    while q:
        node, chain, aq, weak = q.popleft()
        if node in seen: continue
        seen.add(node)
        ek = entry_kind(node)
        ups = REV.get(node, set())
        if ek in ('action',) or (not ups):
            if node not in found: found[node] = (chain, aq, weak, ek or 'root')
            if ek == 'action': continue
        if ek == 'worker' and node not in found: found[node] = (chain, aq, weak, 'worker')
        if len(chain) > 10: continue
        for up, kind in sorted(ups):
            if up in chain: continue
            nq = aq or (kind[6:] if kind.startswith('async:') else None)
            q.append((up, chain + (up,), nq, weak or kind == 'weak'))
    for p in paths:
        lst = callers.setdefault(p, [])
        for node, (chain, aq, weak, ek) in found.items():
            if node == leaf and ek == 'root' and len(chain) == 1: continue   # dead method (nobody calls it)
            lst.append({'e': show(node), 'k': ek, 'chain': [show(x) for x in reversed(chain)], 'aq': aq, 'w': bool(weak)})
# dead gateway methods (defined, never called)
dead = sorted({show(l) + ' ' + p for l, ps in GATEWAY.items() for p in ps if not REV.get(l)})

# ---------------------------------------------------------------- compact emit
NAME_OF = {show(k): k for k in NODES}
MT, MI, PT, PI = [], {}, [], {}
def mi(x):
    if x not in MI: MI[x] = len(MT); MT.append(x)
    return MI[x]
def pi(x):
    if x not in PI: PI[x] = len(PT); PT.append(x)
    return PI[x]
for p in sorted({p for ps in GATEWAY.values() for p in ps}): pi(p)
S = {}
for jid, st in steps_out.items():
    for i, rows in st.items():
        S.setdefault(jid, {})[i] = [[pi(r['p']), mi(r['m']), [mi(v) for v in r['via']], r['aq'] or 0, 1 if r['w'] else 0] for r in rows]
C = {}
KORD = {'action': 0, 'worker': 1, 'hook': 2, 'root': 3}
for p, lst in callers.items():
    lst = sorted(lst, key=lambda x: (KORD.get(x['k'], 9), x['w'], len(x['chain']), x['e']))
    C[str(pi(p))] = [[mi(x['e']), x['k'], [mi(c) for c in x['chain']], x['aq'] or 0, 1 if x['w'] else 0,
                      1 if (x['k'] == 'worker' and not REV.get(NAME_OF.get(x['e'], ''))) else 0] for x in lst]
SRC_DATE = os.environ.get('SRC_DATE', '')
meta = {'v': 1, 'generated': os.environ.get('GEN_DATE', ''), 'source': os.environ.get('SRC_LABEL', 'selfcare-backend'),
        'srcDate': SRC_DATE, 'base': '/api/uil', 'classes': len(KL), 'methods': len(NODES), 'gwMethods': len(GATEWAY),
        'M': MT, 'P': PT, 'S': S, 'C': C, 'dead': dead}
js = ('/* GENERATED by tools/journeys/rbcalls.py from the Digital selfcare backend (Rails) source — do not edit by hand.\n'
      ' * Mobile › Journeys: the BSS gateway calls (APIGW …/api/uil + path, the paths api_traffic_events logs) each journey\n'
      ' * step reaches in code, with the call chain, and for every gateway path the entry points that call it.\n'
      ' * Static analysis, all branches: a listed call CAN happen from that step (conditions in the code decide if it does);\n'
      ' * dynamic dispatch (constantize / send) is not followed. M = method table, P = path table,\n'
      ' * S[journey][step] = [[path, leafMethod, [via…], asyncQueue|0, inferred 0|1]], C[path] = [[entry, kind, [chain…], asyncQueue|0, inferred]]. */\n'
      'window.JOURNEY_GW=' + json.dumps(meta, separators=(',', ':')) + ';\n')
open(OUT, 'w').write(js)
print(json.dumps({'paths': len(PT), 'methods': len(MT), 'steps': sum(len(v) for v in S.values()), 'callers': sum(len(v) for v in C.values()),
                  'bytes': len(js), 'unresolved': steps_unres if False else len(unresolved)}))
