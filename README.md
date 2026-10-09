# Word World 🪶

A word companion for writing poetry and more beautiful prose. Look up any word and see:

- **Meaning**: definitions grouped by part of speech
- **Sound**: IPA pronunciation, syllable breaks, syllable count and its **stress pattern** (with the metrical foot, e.g. *trochee*)
- **Origin**: the etymology, from Wiktionary
- **Rhymes**: perfect and near/slant rhymes, **grouped by number of syllables**
- **Synonyms** and words close in meaning, plus **antonyms**
- **Pairings**: the adjectives writers use with a noun ("pale ember", "dying ember") and the nouns an adjective describes
- **In literature**: the word in use, from four places:
  - **In poems**: lines from public-domain poems (also matching *embers*, *wandered*…). Tap **Read in full →** to open the whole poem, or **☆ Save poem** to keep it
  - **Quoted in books**: dated quotations from Wiktionary
  - **Famous writers**: quotations from Wikiquote
  - **Classic texts**: public-domain books and poems on Wikisource
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
- **📜 Saved poems**: poems you saved show up here too, with a link to read them whole, and you can
  love, annotate and write back to them like any passage

Excerpts from books still under copyright are kept to a line or two. The starter passages
live in **`passages.js`**; add more there, or in the app.

## Where your writing lives

Everything you save (journal, saved poems, loved passages, notes, your writing) is kept in **this browser
only** (localStorage). Nothing is sent anywhere, so it won't sync between your phone and
laptop, and clearing site data erases it.

## Running it

Plain HTML/CSS/JS, no build step, no API keys:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

To use it on your phone, turn on **GitHub Pages** (Settings → Pages → Deploy from branch `main`,
folder `/ (root)`), open the link, and use "Add to Home Screen". It installs as **Word World** with the quill icon.

## Data sources (free, no keys)

- [Datamuse](https://www.datamuse.com/api/): definitions, synonyms, antonyms, rhymes, syllables, stress, pairings
- **Bundled dictionary** (`data/w/`): etymologies for ~360,000 English words, pronunciations and
  book quotations, extracted from [Wiktionary](https://en.wiktionary.org) via [kaikki.org](https://kaikki.org)
  (CC BY-SA 4.0). Inflected forms point to their base word (*embers* → *ember*). It ships with the
  app, so origins load instantly and never hit Wiktionary's rate limits
- [Wiktionary](https://en.wiktionary.org) live: fallback for words the bundle lacks
- [PoetryDB](https://poetrydb.org): public-domain poems, in full
- [Wikiquote](https://en.wikiquote.org) and [Wikisource](https://en.wikisource.org): quotations and classic texts
