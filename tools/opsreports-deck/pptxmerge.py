"""pptxmerge.py — copy slides between PowerPoint packages the way PowerPoint's "Use destination theme" paste does.

Used by build_complete.py to assemble the weekly *Enterprise Platforms & Application Operations* deck from the decks the
vendors send (TCS, Subex, Oracle, Whale Cloud, Technology Platforms, portals) inside the Salam template.

How a slide is copied:
  * the slide XML is copied verbatim (its r:ids stay valid — only relationship *targets* are renamed);
  * every part it uses is copied once per source package: images (de-duplicated by content), charts with their
    embedded workbooks, colour and style parts, SmartArt (diagram data / layout / colours / style / drawing), tags;
  * its layout is copied under the Salam master (master 1) — so the slide keeps its own arrangement but takes the Salam
    theme, fonts and the leaf logo, exactly like the 25 Sep template where every vendor slide sits on master 1;
    a slide that comes from a Salam template uses the destination layout of the same name instead;
  * speaker notes and comments are not carried over.
Only the standard library is used (zipfile + re): OOXML is edited as text so no namespace prefix is ever rewritten.
"""
import hashlib
import posixpath
import re
import zipfile
from collections import OrderedDict

RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
T_SLIDE = RT + '/slide'
T_LAYOUT = RT + '/slideLayout'
T_MASTER = RT + '/slideMaster'
SKIP_TYPES = ('/notesSlide', '/comments', '/commentAuthors', '/customXml')
SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
LAYOUT_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'


def rels_path(part):
    d, b = posixpath.split(part)
    return posixpath.join(d, '_rels', b + '.rels')


def parse_rels(xml):
    out = []
    for m in re.finditer(r'<Relationship\b([^>]*?)/?>', xml):
        a = m.group(1)
        g = lambda k: (re.search(r'\b%s="([^"]*)"' % k, a) or [None, None])[1]
        out.append({'Id': g('Id'), 'Type': g('Type'), 'Target': g('Target'), 'Mode': g('TargetMode')})
    return out


def write_rels(rels):
    body = ''.join('<Relationship Id="%s" Type="%s" Target="%s"%s/>' % (
        r['Id'], r['Type'], r['Target'], ' TargetMode="%s"' % r['Mode'] if r.get('Mode') else '') for r in rels)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + body + '</Relationships>')


class Pkg:
    def __init__(self, path):
        self.path = path
        z = zipfile.ZipFile(path)
        self.files = OrderedDict()
        for n in z.namelist():
            if n.endswith('/'):
                continue
            try:
                self.files[n] = z.read(n)
            except Exception:  # a damaged member (truncated upload) — skipped, reported by the caller
                pass
        ct = self.files['[Content_Types].xml'].decode('utf8')
        self.defaults = dict(re.findall(r'<Default Extension="([^"]+)" ContentType="([^"]+)"', ct))
        self.overrides = dict(re.findall(r'<Override PartName="/([^"]+)" ContentType="([^"]+)"', ct))

    # ---- package helpers
    def text(self, part):
        return self.files[part].decode('utf8')

    def ctype(self, part):
        return self.overrides.get(part) or self.defaults.get(part.rsplit('.', 1)[-1].lower())

    def rels(self, part):
        rp = rels_path(part)
        return parse_rels(self.files[rp].decode('utf8')) if rp in self.files else []

    def resolve(self, part, target):
        if target.startswith('/'):
            return target[1:]
        return posixpath.normpath(posixpath.join(posixpath.dirname(part), target))

    def rel_target(self, frm, to):
        return posixpath.relpath(to, posixpath.dirname(frm))

    def free_name(self, folder, stem, ext):
        used = set(int(m) for n in self.files for m in re.findall(r'^%s/%s(\d+)\.%s$' % (re.escape(folder), re.escape(stem), re.escape(ext)), n))
        i = max(used) + 1 if used else 1
        while posixpath.join(folder, '%s%d.%s' % (stem, i, ext)) in self.files:
            i += 1
        return posixpath.join(folder, '%s%d.%s' % (stem, i, ext))

    def add_part(self, part, data, ctype):
        self.files[part] = data
        ext = part.rsplit('.', 1)[-1].lower()
        if ctype and self.defaults.get(ext) != ctype:
            if ext in self.defaults or ext in ('xml', 'rels'):
                self.overrides[part] = ctype
            else:
                self.defaults[ext] = ctype

    def drop_part(self, part):
        self.files.pop(part, None)
        self.files.pop(rels_path(part), None)
        self.overrides.pop(part, None)

    def save(self, path):
        ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
              '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
              + ''.join('<Default Extension="%s" ContentType="%s"/>' % kv for kv in self.defaults.items())
              + ''.join('<Override PartName="/%s" ContentType="%s"/>' % kv for kv in self.overrides.items() if kv[0] in self.files)
              + '</Types>')
        self.files['[Content_Types].xml'] = ct.encode('utf8')
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('[Content_Types].xml', self.files['[Content_Types].xml'])
            for n, d in self.files.items():
                if n != '[Content_Types].xml':
                    z.writestr(n, d)


class Merger:
    """Builds the destination deck: slides are appended with add_slide(); finish() writes the slide list + sections."""

    def __init__(self, base_path):
        self.T = Pkg(base_path)
        self.memo = {}
        self.layout_memo = {}
        self.media_hash = {}
        for n, d in self.T.files.items():
            if n.startswith('ppt/media/'):
                self.media_hash.setdefault(hashlib.sha1(d).hexdigest(), n)
        self.pres = 'ppt/presentation.xml'
        self.pres_rels = self.T.rels(self.pres)
        self.order = []          # [(slide part, section title)]
        self.masters = [self.T.resolve(self.pres, r['Target']) for r in self.pres_rels if r['Type'] == T_MASTER]
        self.masters.sort(key=lambda p: int(re.findall(r'(\d+)\.xml$', p)[0]))
        self._layout_names = None

    # ---- layouts of the destination, by (master index, name)
    def layout_index(self):
        if self._layout_names is None:
            self._layout_names = {}
            for mi, m in enumerate(self.masters, 1):
                for r in self.T.rels(m):
                    if r['Type'] == T_LAYOUT:
                        lp = self.T.resolve(m, r['Target'])
                        nm = re.search(r'<p:cSld name="([^"]*)"', self.T.text(lp))
                        self._layout_names.setdefault((mi, nm.group(1) if nm else ''), lp)
        return self._layout_names

    def find_layout(self, name, master=None):
        for (mi, nm), lp in self.layout_index().items():
            if nm == name and (master is None or mi == master):
                return lp
        return None

    # ---- generic recursive part copy
    def copy_part(self, S, sp):
        key = (id(S), sp)
        if key in self.memo:
            return self.memo[key]
        if sp not in S.files:
            return None
        data = S.files[sp]
        folder, base = posixpath.split(sp)
        stem, ext = (base.rsplit('.', 1) + [''])[:2]
        stem = re.sub(r'\d+$', '', stem) or 'part'
        if folder == 'ppt/media':
            h = hashlib.sha1(data).hexdigest()
            if h in self.media_hash:
                self.memo[key] = self.media_hash[h]
                return self.media_hash[h]
        new = self.T.free_name(folder, stem, ext)
        self.memo[key] = new
        if folder == 'ppt/media':
            self.media_hash[hashlib.sha1(data).hexdigest()] = new
        self.T.add_part(new, data, S.ctype(sp))
        self._copy_rels(S, sp, new)
        return new

    def _copy_rels(self, S, sp, new, layout_target=None):
        rels = S.rels(sp)
        if not rels:
            return
        out = []
        for r in rels:
            t = r['Type'] or ''
            if r.get('Mode') == 'External':
                out.append(r)
                continue
            if t.endswith(SKIP_TYPES):
                continue
            if t == T_LAYOUT and layout_target:
                out.append(dict(r, Target=self.T.rel_target(new, layout_target)))
                continue
            if t == T_MASTER:
                out.append(dict(r, Target=self.T.rel_target(new, self.masters[0])))
                continue
            if t == T_SLIDE:      # a link to another slide of the vendor deck — kept harmless
                out.append({'Id': r['Id'], 'Type': RT + '/hyperlink', 'Target': '#', 'Mode': 'External'})
                continue
            tgt = self.copy_part(S, S.resolve(sp, r['Target']))
            if tgt:
                out.append(dict(r, Target=self.T.rel_target(new, tgt)))
        self.T.files[rels_path(new)] = write_rels(out).encode('utf8')

    # ---- layouts: same-name destination layout for Salam slides, imported under master 1 for vendor slides
    def map_layout(self, S, slp, reuse_by_name):
        key = (id(S), slp)
        if key in self.layout_memo:
            return self.layout_memo[key]
        x = S.text(slp)
        nm = (re.search(r'<p:cSld name="([^"]*)"', x) or [None, ''])[1]
        if reuse_by_name:
            mr = next((r for r in S.rels(slp) if r['Type'] == T_MASTER), None)
            smasters = sorted([S.resolve('ppt/presentation.xml', r['Target']) for r in S.rels('ppt/presentation.xml') if r['Type'] == T_MASTER],
                              key=lambda p: int(re.findall(r'(\d+)\.xml$', p)[0]))
            mi = smasters.index(S.resolve(slp, mr['Target'])) + 1 if mr and S.resolve(slp, mr['Target']) in smasters else None
            lp = self.find_layout(nm, mi) or self.find_layout(nm)
            if lp:
                self.layout_memo[key] = lp
                return lp
        new = self.T.free_name('ppt/slideLayouts', 'slideLayout', 'xml')
        self.T.add_part(new, S.files[slp], LAYOUT_CT)
        self.layout_memo[key] = new
        self._copy_rels(S, slp, new)
        # register under master 1
        m = self.masters[0]
        mrels = self.T.rels(m)
        rid = 'rId%d' % (max([int(r['Id'][3:]) for r in mrels if r['Id'].startswith('rId') and r['Id'][3:].isdigit()] + [0]) + 1)
        mrels.append({'Id': rid, 'Type': T_LAYOUT, 'Target': self.T.rel_target(m, new), 'Mode': None})
        self.T.files[rels_path(m)] = write_rels(mrels).encode('utf8')
        mx = self.T.text(m)
        nid = self._next_layout_id()
        mx = mx.replace('</p:sldLayoutIdLst>', '<p:sldLayoutId id="%d" r:id="%s"/></p:sldLayoutIdLst>' % (nid, rid), 1)
        self.T.files[m] = mx.encode('utf8')
        self._layout_names = None
        return new

    def _next_layout_id(self):
        ids = [2147483648]
        for m in self.masters:
            ids += [int(v) for v in re.findall(r'<p:sldLayoutId id="(\d+)"', self.T.text(m))]
        ids += [int(v) for v in re.findall(r'<p:sldMasterId id="(\d+)"', self.T.text(self.pres))]
        return max(ids) + 1

    # ---- slides
    def add_slide(self, S, sp, section, reuse_layout_by_name=False, edit=None):
        """copy slide `sp` of package S; `edit(xml) -> xml` may change its text before it is written"""
        rels = S.rels(sp)
        lr = next((r for r in rels if r['Type'] == T_LAYOUT), None)
        lp = self.map_layout(S, S.resolve(sp, lr['Target']), reuse_layout_by_name) if lr else None
        new = self.T.free_name('ppt/slides', 'slide', 'xml')
        x = S.text(sp)
        if edit:
            x = edit(x)
        self.T.add_part(new, x.encode('utf8'), SLIDE_CT)
        self.memo[(id(S), sp)] = new
        self._copy_rels(S, sp, new, layout_target=lp)
        self.order.append((new, section))
        return new

    def add_raw_slide(self, xml, layout_part, images, section):
        """a slide written from scratch; images = {rId: (bytes, ext)} referenced by r:embed in xml"""
        new = self.T.free_name('ppt/slides', 'slide', 'xml')
        self.T.add_part(new, xml.encode('utf8'), SLIDE_CT)
        rels = [{'Id': 'rIdL', 'Type': T_LAYOUT, 'Target': self.T.rel_target(new, layout_part), 'Mode': None}]
        for rid, (data, ext) in images.items():
            h = hashlib.sha1(data).hexdigest()
            mp = self.media_hash.get(h)
            if not mp:
                mp = self.T.free_name('ppt/media', 'image', ext)
                self.T.add_part(mp, data, {'png': 'image/png', 'jpeg': 'image/jpeg', 'jpg': 'image/jpeg'}[ext])
                self.media_hash[h] = mp
            rels.append({'Id': rid, 'Type': RT + '/image', 'Target': self.T.rel_target(new, mp), 'Mode': None})
        self.T.files[rels_path(new)] = write_rels(rels).encode('utf8')
        self.order.append((new, section))
        return new

    def source_slides(self, S):
        """slide parts of a package in presentation order"""
        p = S.text('ppt/presentation.xml')
        rmap = {r['Id']: S.resolve('ppt/presentation.xml', r['Target']) for r in S.rels('ppt/presentation.xml')}
        return [rmap[i] for i in re.findall(r'<p:sldId\b[^>]*\br:id="([^"]+)"', p) if rmap.get(i) in S.files]

    def finish(self, out_path, drop_unlisted=True):
        T = self.T
        px = T.text(self.pres)
        keep = set(p for p, _ in self.order)
        # drop the base deck's own slides that are not in the new order
        prels = [r for r in self.pres_rels if not (r['Type'] == T_SLIDE and T.resolve(self.pres, r['Target']) not in keep)]
        if drop_unlisted:
            for n in list(T.files):
                if re.match(r'ppt/slides/slide\d+\.xml$', n) and n not in keep:
                    T.drop_part(n)
            for n in list(T.files):
                if re.match(r'ppt/notesSlides/', n):
                    T.drop_part(n)
        used = set(int(r['Id'][3:]) for r in prels if r['Id'].startswith('rId') and r['Id'][3:].isdigit())
        nxt = max(used | {0}) + 1
        ids, sld_ids = [], []
        for i, (p, sec) in enumerate(self.order):
            rid = 'rId%d' % nxt
            nxt += 1
            prels.append({'Id': rid, 'Type': T_SLIDE, 'Target': T.rel_target(self.pres, p), 'Mode': None})
            sid = 256 + i
            ids.append('<p:sldId id="%d" r:id="%s"/>' % (sid, rid))
            sld_ids.append((sid, sec))
        lst = '<p:sldIdLst>' + ''.join(ids) + '</p:sldIdLst>'
        if '<p:sldIdLst>' in px:
            px = re.sub(r'<p:sldIdLst>.*?</p:sldIdLst>', lst, px, flags=re.S)
        else:
            px = px.replace('</p:sldMasterIdLst>', '</p:sldMasterIdLst>' + lst, 1)
        # sections (PowerPoint 2010+): one per domain
        secs = OrderedDict()
        for sid, sec in sld_ids:
            secs.setdefault(sec or 'Deck', []).append(sid)
        import uuid
        sec_xml = ('<p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">'
                   + ''.join('<p14:section name="%s" id="{%s}"><p14:sldIdLst>%s</p14:sldIdLst></p14:section>' % (
                       name.replace('&', '&amp;').replace('<', '&lt;').replace('"', '&quot;'), str(uuid.uuid4()).upper(),
                       ''.join('<p14:sldId id="%d"/>' % s for s in sl)) for name, sl in secs.items())
                   + '</p14:sectionLst></p:ext>')
        px = re.sub(r'<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">.*?</p:ext>', '', px, flags=re.S)
        if '<p:extLst>' in px:
            px = px.replace('<p:extLst>', '<p:extLst>' + sec_xml, 1)
        else:
            px = px.replace('</p:presentation>', '<p:extLst>' + sec_xml + '</p:extLst></p:presentation>')
        T.files[self.pres] = px.encode('utf8')
        T.files[rels_path(self.pres)] = write_rels(prels).encode('utf8')
        # docProps/app.xml slide counts are informative only; PowerPoint rewrites them on save
        T.save(out_path)
