# Quill 🪶

A word companion for writing poetry and more beautiful prose. Look up any word and see:

- **Meaning**: definitions grouped by part of speech
- **Sound**: IPA pronunciation, syllable breaks, syllable count and its **stress pattern** (with the metrical foot, e.g. *trochee*)
- **Origin**: the etymology, from Wiktionary
- **Rhymes**: perfect and near/slant rhymes, **grouped by number of syllables**
- **Synonyms** and words close in meaning, plus **antonyms**
- **Pairings**: the adjectives writers use with a noun ("pale ember", "dying ember") and the nouns an adjective describes
- **In poetry**: lines from public-domain poems that use the word, with the word highlighted
- **Make it yours**: write a line with the word; it goes into your **Journal** with the saved word

Also: a word of the day, a *Surprise me* button, and every word on every page is a link.

## Inspiration tab

Passages considered beautiful: Plath, Lispector, Morrison, Hemingway, Nabokov, McCarthy,
Anne Carson, Woolf, Joyce, Fitzgerald, Baldwin, Didion, Marilynne Robinson, Annie Dillard,
Mary Oliver and Dickinson. For each passage you can:

- **♡ Love** it (filter by *Loved*)
- add a **💬 Note**: what stops you there
- **✎ Write back**: attach your own writing in answer to it (filter by *With my writing*)
- tap any word in it to open that word's page
- **+ Add a passage** of your own from any book you're reading

Excerpts from books still under copyright are kept to a line or two. The starter passages
live in **`passages.js`**; add more there, or in the app.

## Where your writing lives

Everything you save (journal, loved passages, notes, your writing) is kept in **this browser
only** (localStorage). Nothing is sent anywhere, so it won't sync between your phone and
laptop, and clearing site data erases it.

## Running it

Plain HTML/CSS/JS, no build step, no API keys:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

To use it on your phone, turn on **GitHub Pages** (Settings → Pages → Deploy from branch `main`,
folder `/ (root)`), open the link, and use "Add to Home Screen".

## Data sources (free, no keys)

- [Datamuse](https://www.datamuse.com/api/): definitions, synonyms, antonyms, rhymes, syllables, stress, pairings
- [Wiktionary](https://en.wiktionary.org): etymology, IPA, hyphenation (cached in the browser after the first lookup)
- [PoetryDB](https://poetrydb.org): public-domain poems
