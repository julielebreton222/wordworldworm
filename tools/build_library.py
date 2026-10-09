# Build the "From writers you love" index: for each word, up to K short passages from the
# curated public-domain library, spread across as many different authors as possible.
# Usage: download each book in books.py to txt/<id>.txt (https://www.gutenberg.org/cache/epub/<id>/pg<id>.txt),
# then run: python3 tools/build_library.py data/lib
import re, json, os, sys, random, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books import BOOKS

DROP = {45159, 42543, 76889, 60433, 71448, 76016, 66057}   # commentary or anthology text mixed in
PROSE_POEMS = {7164, 6524, 6686, 6522}               # Tagore's prose translations
START = {  # where the author's own text begins, past other people's introductions
    60093: "Her skin is like dusk", 64989: "In putting ideas and feelings into poetry",
    680: "PALANQUIN BEARERS", 7164: "Thou hast made me endless", 66057: "At the Court of an Emperor",
    38594: "FIRST POEMS\n", 12242: "LIFE.\n\n\nI.", 50489: "The Moon, who is caprice itself",
    59276: "IN THE RANGITAKI VALLEY\n\n\n", 66871: "THE DOLL’S HOUSE\n\n\nWhen",
}
STOP = set("""a about above after again against all am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he
her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not
now of off on once only or other our ours ourselves out over own same she should so some such than that the
their theirs them themselves then there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your yours yourself yourselves said says say one
upon shall may might must also yet ever every much many thee thou thy thine ye""".split())
K = 6
books = [b for b in BOOKS if b[0] not in DROP]

def body_of(bid):
    s = open(f"txt/{bid}.txt", encoding="utf-8").read()
    s = s[s.find("*** START OF"):]
    s = s[s.find("\n") + 1:]
    end = s.find("*** END OF")
    s = s[:end if end > 0 else len(s)]
    if bid in START:
        i = s.find(START[bid]); assert i >= 0, bid
        s = s[i:]
    # Editors' back matter (notes, appendices, indexes) isn't the author's writing.
    for m in re.finditer(r"(?m)^\s*(NOTES?\.?|APPENDIX.*|INDEX.*|GLOSSARY\.?|BIBLIOGRAPHY\.?)\s*$", s):
        if m.start() > 0.7 * len(s):
            s = s[:m.start()]; break
    s = re.sub(r"\[(Illustration|Footnote|Sidenote)[^\]]*\]", "", s, flags=re.S)
    s = re.sub(r"\[[^\]]{20,}\]", "", s, flags=re.S)  # bracketed editorial asides
    s = re.sub(r"\[\d+\]", "", s)
    s = s.replace("_", "").replace("\r", "")
    return s

def ok_text(t):
    letters = sum(c.isalpha() for c in t)
    return (letters > 0.6 * len(t) and t != t.upper() and "Gutenberg" not in t and "CHAPTER" not in t
            and len(re.findall(r"\b1[5-9]\d\d\b", t)) < 2          # copyright pages, bibliographies
            and not re.search(r"\b(Reprinted|Copyright|All rights reserved|Printed in|first published)\b", t))

snips = []        # (book_index, text, kind)
postings = collections.defaultdict(list)
tok = re.compile(r"[a-z]+(?:'[a-z]+)?")

def add(bi, text, kind, index_text):
    sid = len(snips)
    snips.append((bi, text, kind))
    for w in set(tok.findall(index_text.lower().replace("’", "'"))):
        if len(w) >= 3 and w not in STOP:
            postings[w].append(sid)

for bi, (bid, author, title, year, kind) in enumerate(books):
    s = body_of(bid)
    blocks = [b for b in re.split(r"\n\s*\n", s) if b.strip()]
    if kind == "poetry" and bid not in PROSE_POEMS:
        for b in blocks:
            lines = [re.sub(r"\s{2,}\d+$", "", l.strip()) for l in b.split("\n") if l.strip()]  # line numbers
            if all(l == l.upper() for l in lines): continue  # titles, headings
            for i, l in enumerate(lines):
                if len(l) < 12 or not ok_text(l): continue
                ctx = lines[max(0, i - 1): i + 2]
                text = "\n".join(ctx)
                if len(text) <= 260: add(bi, text, "v", l)
    else:
        for b in blocks:
            para = re.sub(r"\s+", " ", b).strip()
            if len(para) < 40 or para == para.upper(): continue
            for sent in re.split(r"(?<=[.!?])[”’\"')]*\s+(?=[“‘\"'(]?[A-Z])", para):
                sent = sent.strip()
                if 50 <= len(sent) <= 300 and len(sent.split()) >= 8 and ok_text(sent):
                    add(bi, sent, "p", sent)
    print(f"{author[:30]:30} {title[:30]:30} snippets so far {len(snips)}", file=sys.stderr)

def score(sid, rng):
    n = len(snips[sid][1])
    return abs(n - 140) / 140 + rng.random() * 0.8

out = collections.defaultdict(dict)
key = lambda w: "".join(c if c.isalpha() and c.isascii() else "_" for c in (w + "__")[:3])
for w, ids in postings.items():
    rng = random.Random(w)
    ranked = sorted(ids, key=lambda sid: score(sid, rng))
    chosen, seen_authors = [], set()
    for sid in ranked:  # first pass: one per author
        a = books[snips[sid][0]][1]
        if a not in seen_authors:
            chosen.append(sid); seen_authors.add(a)
        if len(chosen) == K: break
    for sid in ranked:  # top up if few authors use the word
        if len(chosen) == K: break
        if sid not in chosen: chosen.append(sid)
    out[key(w)][w] = [[snips[s][0], snips[s][1], snips[s][2]] for s in chosen]

dest = sys.argv[1]
os.makedirs(dest, exist_ok=True)
json.dump([[b[0], b[1], b[2], b[3]] for b in books], open(os.path.join(dest, "books.json"), "w"), ensure_ascii=False)
total = 0
for k, v in out.items():
    s = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(dest, k + ".json"), "w").write(s); total += len(s.encode())
print(f"{len(books)} books, {len(snips)} passages, {len(postings)} words, {len(out)} shards, {total/1e6:.1f} MB")
