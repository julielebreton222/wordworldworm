# Stream the kaikki.org English Wiktionary dump from stdin and keep, per word:
# etymologies (deduped), IPA, and the lemma for inflected forms (embers -> ember).
# Usage: curl -sS https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl | python3 tools/extract_wiktionary.py
import sys, json, re
ok = re.compile(r"^[a-z][a-z'\-]*$")
etym, lemma, ipa, quotes = {}, {}, {}, {}
n = 0
for line in sys.stdin:
    n += 1
    if n % 200000 == 0: print(n, len(etym), file=sys.stderr, flush=True)
    try: e = json.loads(line)
    except Exception: continue
    if e.get("lang_code") != "en": continue
    w = e.get("word", "")
    if not ok.match(w) or len(w) > 30: continue
    t = (e.get("etymology_text") or "").strip()
    if t:
        lst = etym.setdefault(w, [])
        if t not in lst: lst.append(t)
    if w not in ipa:
        for s in e.get("sounds", []):
            if s.get("ipa", "").startswith("/"):
                ipa[w] = s["ipa"]; break
    for s in e.get("senses", []):
        for ex in s.get("examples", []):
            txt, ref = (ex.get("text") or "").strip(), (ex.get("ref") or "").strip()
            if ex.get("type") == "quotation" and txt and ref and len(txt) <= 400:
                q = quotes.setdefault(w, [])
                if len(q) < 4 and all(txt != x[0] for x in q):
                    q.append([txt, ref[:200]])
        for f in s.get("form_of", []) + s.get("alt_of", []):
            lw = f.get("word", "")
            if ok.match(lw) and lw != w:
                lemma.setdefault(w, lw)
json.dump({"etym": etym, "lemma": lemma, "ipa": ipa, "quotes": quotes}, open("raw.json", "w"))
print("done", n, len(etym), len(lemma), len(ipa), len(quotes), file=sys.stderr)
