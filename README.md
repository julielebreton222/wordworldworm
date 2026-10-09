# Word World 🪶

A word companion for writing poetry and more beautiful prose. Look up any word and see:

- **Meaning**: definitions grouped by part of speech
- **Sound**: IPA pronunciation, syllable breaks, syllable count and its **stress pattern** (with the metrical foot, e.g. *trochee*)
- **Origin**: the etymology, from Wiktionary
- **Rhymes**: perfect and near/slant rhymes, **grouped by number of syllables**
- **Synonyms** and words close in meaning, plus **antonyms**
- **Pairings**: the adjectives writers use with a noun ("pale ember", "dying ember") and the nouns an adjective describes
- **In literature**: the word in use, in this order:
  - **Your passages**: anything in your Inspiration tab that uses the word
  - **Your writers**: short quotations from 47 writers (Plath, Lispector, Morrison, Hemingway, Nabokov,
    McCarthy, Carson, Baldwin, Didion, Woolf, Lorde, Adichie, Le Guin, Pessoa…), from Wikiquote,
    with your favourites first
  - **From the library**: passages from 81 free, public-domain books (see below)
  - **See it in their books**: one tap searches Google Books for the word inside each favourite
    writer's books. Add or remove writers right there
  - **More from the archives** (folded away): older poems you can save and read in full, dictionary
    quotations, Wikisource
- **Make it yours**: write a line with the word; it goes into your **Journal** with the saved word

Also: a word of the day, a *Surprise me* button, and every word on every page is a link.

## Workshop tab

Paste a poem or passage and edit it in ten short steps (about 5–10 minutes each), one at a time,
with only that step's problems highlighted. Built for short bursts of focus: skip any step, use the
optional 5-minute timer, stop anytime (it saves as you go).

1. **Hear it**: the app reads it aloud; tap lines where you stumble (Ursula K. Le Guin)
2. **Find the heart**: the one line you'd keep (Richard Hugo)
3. **Cut 10%**: filler words highlighted, with a word-count target (Stephen King, George Orwell)
4. **Show, don't name**: abstract words highlighted, each linked to its word page (Ezra Pound, Natalie Goldberg)
5. **Fresh, not familiar**: clichés flagged (George Orwell)
6. **Strong verbs**: weak verbs and -ly adverbs (Strunk & White)
7. **Line endings & sound**: weak line endings, syllables per line, end words linked to rhymes (Mary Oliver)
8. **The edges**: read it without the first line, then without the last
9. **Title**
10. **Read it once more**: compare first draft and now, and ideas for what to do with it next

## Inspiration tab

Passages considered beautiful: Plath, Lispector, Morrison, Hemingway, Nabokov, McCarthy,
Anne Carson, Woolf, Joyce, Fitzgerald, Baldwin, Didion, Marilynne Robinson, Annie Dillard,
Mary Oliver and Dickinson. For each passage you can:

- **♡ Love** it (filter by *Loved*)
- add a **💬 Note**: what stops you there
- **✎ Write back**: attach your own writing in answer to it (filter by *With my writing*)
- tap any word in it to open that word's page
- **+ Add a passage** of your own from any book you're reading
- **🔖 Saved**: every poem and passage you save from a word page (tap **☆ Save**) lands here, with
  a link to read the whole poem or book. You can love, annotate and write back to them like any
  passage. The Journal drawer links here too

Excerpts from books still under copyright are kept to a line or two. The starter passages
live in **`passages.js`**; add more there, or in the app.

## The library

"From writers you love" draws on complete books that are free to share, weighted toward women and
writers of color: early Hemingway (*The Sun Also Rises*, *A Farewell to Arms*, *In Our Time*,
*Men Without Women*), Virginia Woolf, Katherine Mansfield, Zora Neale Hurston, Jean Toomer,
Langston Hughes, Countee Cullen, Claude McKay, Wallace Thurman, Eric Walrond, Jessie Redmon Fauset,
Alice Dunbar-Nelson, Zitkála-Šá, Sui Sin Far, Sarojini Naidu, Tagore, Kahlil Gibran, Edna St. Vincent
Millay, Sara Teasdale, Emily Dickinson, H.D., Marianne Moore, Dorothy Parker, Gertrude Stein, Djuna
Barnes, Jean Rhys, Kate Chopin, Edith Wharton, Willa Cather, Emily Brontë, Mary Shelley and more.
The full list is in `tools/books.py`.

Writers still under copyright (Plath, Lispector, Morrison, Nabokov, McCarthy, Anne Carson, Madeline
Cash) can't be bundled as whole books. They appear through short, sourced Wikiquote quotations, the
"See it in their books" searches, and any passages you add in the **Inspiration** tab.

Introductions and notes written by editors or translators are cut out so every passage is the
author's own words.

## Rebuilding the data

The scripts in `tools/` regenerate `data/w/` (dictionary), `data/lib/` (library) and `data/quotes/` (quotations); each file
explains how to run it. To add a book to the library, add its Project Gutenberg id to `tools/books.py`.

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
- [Project Gutenberg](https://www.gutenberg.org): the books in the library
- [Wikiquote](https://en.wikiquote.org) (CC BY-SA 4.0): writers' quotations, bundled in `data/quotes/`
- [PoetryDB](https://poetrydb.org): public-domain poems, in full
- [Wikiquote](https://en.wikiquote.org) and [Wikisource](https://en.wikisource.org): quotations and classic texts
