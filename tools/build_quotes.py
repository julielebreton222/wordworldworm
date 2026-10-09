# Turn Wikiquote pages (raw wikitext, one file per writer) into data/quotes/:
#   authors.json        ["Sylvia Plath", ...]
#   <prefix>.json       { word: [[authorIndex, quote, source], ...] }   up to 6 per word, spread across writers
# Usage: save each writer's page as <folder>/<Name>.wiki from
#   https://en.wikiquote.org/w/index.php?title=<Name>&action=raw   (wait a few seconds between pages)
# then: python3 tools/build_quotes.py <folder> data/quotes
import re, json, os, sys, html, random, collections

SKIP_SECTION = re.compile(r"about|misattribut|disputed|attributed|external|see also|sources|references|"
                          r"further reading|works|bibliography|biograph|criticism|tribute", re.I)
EN_WORDS = set("the and of to a in is i you it that was for my me we be not with as but this are what".split())
STOP = set("""a about above after again against all am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he
her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not
now of off on once only or other our ours ourselves out over own same she should so some such than that the
their theirs them themselves then there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your yours yourself yourselves said says say one
upon shall may might must also yet ever every much many thee thou thy thine ye""".split())

def clean(t):
    t = re.sub(r"<ref[^>]*/>|<ref.*?</ref>|<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"\{\{\s*(pb|nl|-)\s*\}\}", "\n", t)  # line and stanza breaks in poems
    for _ in range(3):
        t = re.sub(r"\{\{[^{}]*\}\}", "", t)
    t = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", "", t)
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", t)
    t = re.sub(r"\[https?://\S+\]", "", t)
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("'''", "").replace("''", "")
    t = html.unescape(t)
    t = "\n".join(re.sub(r"[ \t]+", " ", l).strip() for l in t.split("\n"))
    return t.strip()

def english(t):
    words = re.findall(r"[a-zA-Z']+", t.lower())
    return words and sum(w in EN_WORDS for w in words) / len(words) > 0.12

def parse(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    out, heading, top, skip = [], "", "", False
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^(=+)\s*(.*?)\s*=+\s*$", line)
        if m:
            level, title = len(m.group(1)), clean(m.group(2))
            if level == 2:
                top = title
                skip = bool(SKIP_SECTION.search(title)) and not re.match(r"^quotes?$", title, re.I)
            elif SKIP_SECTION.search(title):
                skip = True
            heading = title if level > 2 else ""
            i += 1; continue
        if skip or not re.match(r"^\*[^*]", line):
            i += 1; continue
        text = clean(line[1:])
        subs = []
        j = i + 1
        while j < len(lines) and re.match(r"^\*\*", lines[j]):
            subs.append((len(re.match(r"^\*+", lines[j]).group(0)), clean(re.sub(r"^\*+", "", lines[j]))))
            j += 1
        source = ""
        if not english(text) and subs and subs[0][0] == 2 and english(subs[0][1]):
            text = subs[0][1]                       # the English translation of a quote in Portuguese, Spanish...
            source = next((s for lvl, s in subs[1:] if lvl >= 3), "")
        elif subs:
            source = next((x for _, x in subs if not re.match(r"^(Original|Translation|Variant)", x, re.I)), "")
        trail = re.search(r"\s*\(([^()]{1,70})\)\s*$", text)  # "(p59)" or ("Obsession") at the end
        if trail:
            text = text[:trail.start()].strip()
            source = source or trail.group(1)
        source = source or heading
        source = re.sub(r"\s+", " ", source).strip()
        source = re.sub(r"\s*·?\s*Full text online.*$", "", source)
        if len(source) > 140:
            source = source[:137].rsplit(" ", 1)[0] + "…"
        if 25 <= len(text) <= 450 and english(text):
            out.append((text, source))
        i = j
    return out

def name_of(fname):
    return os.path.splitext(fname)[0].replace("_", " ").replace("Bell hooks", "bell hooks")

src, dest = sys.argv[1], sys.argv[2]
authors, quotes = [], []
for f in sorted(os.listdir(src)):
    if not f.endswith(".wiki"):
        continue
    if "too many requests" in open(os.path.join(src, f), encoding="utf-8").read(400).lower():
        continue
    qs = parse(os.path.join(src, f))
    if not qs:
        continue
    authors.append(name_of(f))
    quotes += [(len(authors) - 1, t, s) for t, s in qs]
    print(f"{name_of(f):28} {len(qs)} quotes", file=sys.stderr)

postings = collections.defaultdict(list)
tok = re.compile(r"[a-z]+(?:'[a-z]+)?")
for qi, (ai, t, s) in enumerate(quotes):
    for w in set(tok.findall(t.lower().replace("’", "'"))):
        if len(w) >= 3 and w not in STOP:
            postings[w].append(qi)

key = lambda w: "".join(c if c.isalpha() and c.isascii() else "_" for c in (w + "__")[:3])
out = collections.defaultdict(dict)
for w, ids in postings.items():
    rng = random.Random(w)
    ids = sorted(ids, key=lambda q: abs(len(quotes[q][1]) - 160) / 160 + rng.random())
    chosen, seen = [], set()
    for q in ids:
        if quotes[q][0] not in seen:
            chosen.append(q); seen.add(quotes[q][0])
        if len(chosen) == 6: break
    for q in ids:
        if len(chosen) == 6: break
        if q not in chosen: chosen.append(q)
    out[key(w)][w] = [list(quotes[q]) for q in chosen]

os.makedirs(dest, exist_ok=True)
json.dump(authors, open(os.path.join(dest, "authors.json"), "w"), ensure_ascii=False)
total = 0
for k, v in out.items():
    s = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(dest, k + ".json"), "w").write(s); total += len(s.encode())
print(f"{len(authors)} writers, {len(quotes)} quotes, {len(postings)} words, {total/1e6:.1f} MB")
