# Split raw.json into data/w/<first three letters>.json shards for the app.
# Usage (after extract_wiktionary.py has written raw.json): python3 tools/build_dictionary.py data/w
import json, os, sys, collections
raw = json.load(open("raw.json"))
etym, lemma, ipa, quotes = raw["etym"], raw["lemma"], raw["ipa"], raw["quotes"]
out = collections.defaultdict(dict)
key = lambda w: "".join(c if c.isalpha() and c.isascii() else "_" for c in (w + "__")[:3])
words = set(etym) | set(quotes) | {w for w in lemma if w not in etym}
for w in words:
    d = {}
    if w in etym: d["e"] = [t[:1500] for t in etym[w][:3]]
    elif w in lemma: d["l"] = lemma[w]
    if w in ipa: d["i"] = ipa[w]
    if w in quotes: d["q"] = quotes[w]
    out[key(w)][w] = d
dest = sys.argv[1]
os.makedirs(dest, exist_ok=True)
total = 0
for k, v in out.items():
    s = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(dest, k + ".json"), "w").write(s)
    total += len(s.encode())
big = sorted(((len(json.dumps(v)), k) for k, v in out.items()), reverse=True)[:5]
print(f"{len(words)} words, {len(out)} shards, {total/1e6:.1f} MB total, biggest: {big}")
