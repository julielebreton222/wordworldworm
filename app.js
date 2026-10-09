/* Word World: a word companion for poets and prose writers.
 * Plain JS, no build step. Data comes from three free, keyless APIs:
 *   Datamuse   – definitions, synonyms, antonyms, rhymes, syllables, stress, word pairings
 *   Wiktionary – etymology, IPA pronunciation, hyphenation
 *   PoetryDB   – public-domain poems that use the word
 */
(() => {
  const DATAMUSE = "https://api.datamuse.com/words";
  const WIKT = "https://en.wiktionary.org/w/api.php";
  const POETRY = "https://poetrydb.org";

  const POS = { n: "noun", v: "verb", adj: "adjective", adv: "adverb", u: "other" };

  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $("#app");

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordLink = (w) => `<a class="chip" href="#/${encodeURIComponent(w)}">${esc(w)}</a>`;

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("quill:" + key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("quill:" + key, JSON.stringify(value)); } catch { /* private mode */ }
    },
  };

  async function getJSON(url, timeoutMs = 15000, retries = 2) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status === 429 && retries > 0) {
        await new Promise((r) => setTimeout(r, 1500));
        return getJSON(url, timeoutMs, retries - 1);
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  const datamuse = (params) => getJSON(DATAMUSE + "?" + new URLSearchParams(params));

  // ---------- meter ----------
  // Datamuse gives ARPAbet pronunciation, e.g. "EH1 M B ER0". The digit on each vowel is its stress.
  function stressPattern(tags = []) {
    const pron = tags.find((t) => t.startsWith("pron:"));
    if (!pron) return null;
    const digits = pron.slice(5).match(/\d/g);
    if (!digits) return null;
    return digits.map((d) => (d === "1" ? "stressed" : d === "2" ? "secondary" : "unstressed"));
  }

  function meterName(pattern) {
    const p = pattern.map((s) => (s === "unstressed" ? "u" : "/")).join("");
    const feet = { "u/": "iamb", "/u": "trochee", "uu/": "anapest", "/uu": "dactyl", "//": "spondee", "u/u": "amphibrach" };
    return feet[p] || null;
  }

  // ---------- bundled dictionary: etymology, IPA, quotations ----------
  // data/w/<first three letters>.json holds an extract of English Wiktionary (via kaikki.org):
  //   { word: { e: [etymologies], i: "/ipa/", q: [[quotation, source]], l: "lemma" } }
  // `l` is set for inflected forms, so "embers" leads to "ember". Shards load on demand and stay cached.
  const shards = {};
  const shardKey = (w) => (w + "__").slice(0, 3).replace(/[^a-z_]/g, "_");
  const shard = (w) => (shards[shardKey(w)] ||= getJSON(`data/w/${shardKey(w)}.json`).catch(() => ({})));

  // Bundled etymologies are plain text. Many start with an "Etymology tree" (one ancestor per line,
  // oldest first), which is drawn here as a lineage; short lines like "Cognates" become subheadings.
  function etymHTML(text) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let out = "", open = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^PIE (word|root)$/.test(line)) { i++; continue; } // a caption plus its root, repeated in the tree
      if (line === "Etymology tree") {
        const steps = [];
        while (i + 1 < lines.length && lines[i + 1].length < 70 && !/[.:;]$/.test(lines[i + 1]) &&
               !/^(From|Borrowed|Inherited|Learned|Compound|Coined|Blend|Clipping|Back-formation)\b/.test(lines[i + 1])) {
          steps.push(lines[++i]);
        }
        out += `<ol class="lineage">${steps.map((st) => {
          const cut = st.lastIndexOf(" ");
          return cut > 0 ? `<li>${esc(st.slice(0, cut))} <em>${esc(st.slice(cut + 1))}</em></li>` : `<li>${esc(st)}</li>`;
        }).join("")}</ol>`;
      } else if (line.length < 30 && !/[.,;:]$/.test(line) && /^[A-Z]/.test(line) && !line.includes(" ")) {
        // Side notes such as "Cognates" fold away so the word's own story reads first.
        out += `${open ? "</details>" : ""}<details><summary>${esc(line)}</summary>`;
        open = true;
      } else {
        const cut = i === lines.length - 1 && !/[.)”"\]]$/.test(line) ? "…" : ""; // the extract trims long notes
        out += `<p>${esc(line)}${cut}</p>`;
      }
    }
    return out + (open ? "</details>" : "");
  }

  async function bundled(word) {
    const entry = (await shard(word))[word];
    if (!entry) return null;
    if (entry.e || !entry.l) return { ...entry, word };
    const base = (await shard(entry.l))[entry.l];
    return base ? { ...base, word: entry.l, formOf: entry.l, i: entry.i || base.i } : null;
  }

  // ---------- Wiktionary: etymology, IPA, hyphenation ----------
  // Turn a Wiktionary <p> into safe HTML: plain text, with the quoted word forms kept in italics.
  function cleanNode(node, boldAsMark = false) {
    let out = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) out += esc(c.textContent);
      else if (c.nodeType === 1) {
        if (c.matches("sup, .reference, style, .mw-editsection")) return;
        const inner = cleanNode(c, boldAsMark);
        if (c.tagName === "I" || c.tagName === "EM") out += `<em>${inner}</em>`;
        else if (boldAsMark && c.tagName === "B") out += `<mark>${inner}</mark>`;
        else out += inner;
      }
    });
    return out;
  }

  // Etymologies don't change, so each word's result is cached in the browser after the first fetch.
  // The origin and literature sections both ask for the page at once; share one request.
  const wiktInflight = {};
  function wiktionary(word) {
    return (wiktInflight[word] ||= loadWiktionary(word).finally(() => delete wiktInflight[word]));
  }

  async function loadWiktionary(word) {
    const cache = store.get("wikt", {});
    if (cache[word] && cache[word].quotes) return cache[word];
    const result = await fetchWiktionary(word);
    if (result) {
      const keys = Object.keys(cache);
      if (keys.length > 300) delete cache[keys[0]];
      cache[word] = result;
      store.set("wikt", cache);
    }
    return result;
  }

  async function fetchWiktionary(word) {
    const tryPage = async (page) => {
      const url = WIKT + "?" + new URLSearchParams({
        action: "parse", page, prop: "text", format: "json", formatversion: "2", redirects: "1", origin: "*",
      });
      const data = await getJSON(url);
      if (data.error) return null;
      return data.parse.text;
    };
    let html = await tryPage(word.toLowerCase());
    if (!html && word !== word.toLowerCase()) html = await tryPage(word);
    if (!html) return null;

    const doc = new DOMParser().parseFromString(html, "text/html");
    const english = doc.getElementById("English");
    if (!english) return null;

    const result = { etymology: [], ipa: null, hyphenation: null, quotes: [] };
    let node = (english.closest(".mw-heading") || english).nextElementSibling;
    let inEtym = false;
    while (node) {
      const isHeading = node.classList.contains("mw-heading") || /^H[2-6]$/.test(node.tagName);
      if (isHeading) {
        if (node.classList.contains("mw-heading2") || node.tagName === "H2") break; // next language
        const h = node.querySelector("h3, h4, h5") || node;
        inEtym = /^Etymology/.test(h.id || h.textContent);
      } else {
        if (inEtym && node.tagName === "P") {
          const text = cleanNode(node).trim();
          if (text) result.etymology.push(text);
        }
        if (!result.ipa) {
          const ipa = node.querySelector && node.querySelector(".IPA");
          if (ipa && /^[/[]/.test(ipa.textContent)) result.ipa = ipa.textContent;
        }
        // Dated quotations from books, used to illustrate each sense.
        node.querySelectorAll && node.querySelectorAll(".citation-whole").forEach((c) => {
          const passage = c.querySelector(".cited-passage, .e-quotation");
          const source = c.querySelector(".cited-source");
          if (!passage || !source || result.quotes.length >= 12) return;
          source.querySelectorAll("small, sup, .q-hellip-b, .q-hellip-sp").forEach((x) => x.remove());
          const text = cleanNode(passage, true).trim();
          const cite = source.textContent.replace(/\s+/g, " ").replace(/[:,]\s*$/, "").trim();
          if (text) result.quotes.push({ text, cite: cite.length > 180 ? cite.slice(0, 177) + "…" : cite });
        });
        if (!result.hyphenation && node.tagName === "UL") {
          const li = [...node.querySelectorAll("li")].find((l) => /^Hyphenation/.test(l.textContent));
          if (li) result.hyphenation = li.textContent.replace(/^Hyphenation:\s*/, "").trim();
        }
      }
      node = node.nextElementSibling;
    }
    return result;
  }

  // ---------- poems: saving and reading in full ----------
  // Saved under "quill:poems" as { id: { author, title, lines, savedAt } } so they open offline.
  const poemCache = {};
  const poemId = (p) => `poem:${p.author}|${p.title}`;
  const poemHref = (p, word) => `#poem/${encodeURIComponent(p.author)}/${encodeURIComponent(p.title)}` +
    (word ? `/${encodeURIComponent(word)}` : "");
  const isSaved = (id) => !!store.get("poems", {})[id];
  const saveLabel = (id) => (isSaved(id) ? "★ Saved" : "☆ Save poem");

  function toggleSavePoem(id) {
    const saved = store.get("poems", {});
    if (saved[id]) {
      const notes = (loadInspo().notes[id] || []).length;
      if (notes && !confirm("Unsave this poem? Your notes and writing on it will be hidden until you save it again.")) return;
      delete saved[id];
    } else {
      const p = poemCache[id];
      if (!p) return;
      saved[id] = { ...p, savedAt: Date.now() };
    }
    store.set("poems", saved);
    document.querySelectorAll(`[data-save-poem="${CSS.escape(id)}"]`).forEach((b) => {
      b.textContent = saveLabel(id);
      b.classList.toggle("on", isSaved(id));
    });
  }

  // Library passages can be saved too: "quill:quotes" = { id: { author, work, year, text, url, savedAt } }.
  const quoteCache = {};
  const quoteId = (text) => {
    let h = 0;
    for (const c of text) h = (h * 31 + c.codePointAt(0)) | 0;
    return "quote:" + (h >>> 0).toString(36);
  };
  const isQuoteSaved = (id) => !!store.get("quotes", {})[id];
  const quoteLabel = (id) => (isQuoteSaved(id) ? "★ Saved" : "☆ Save");

  function toggleSaveQuote(id) {
    const saved = store.get("quotes", {});
    if (saved[id]) {
      const notes = (loadInspo().notes[id] || []).length;
      if (notes && !confirm("Unsave this passage? Your notes and writing on it will be hidden until you save it again.")) return;
      delete saved[id];
    } else {
      if (!quoteCache[id]) return;
      saved[id] = { ...quoteCache[id], savedAt: Date.now() };
    }
    store.set("quotes", saved);
    document.querySelectorAll(`[data-save-quote="${CSS.escape(id)}"]`).forEach((b) => {
      b.textContent = quoteLabel(id);
      b.classList.toggle("on", isQuoteSaved(id));
    });
  }

  // A small note that says where saved things went.
  let toastTimer;
  function toast(html) {
    let el = $("#toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
  }
  const savedToast = () => toast(`Saved to <a href="#inspiration" data-open-saved>Inspiration → 🔖 Saved</a>`);

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-saved]")) {
      inspoState.filter = "saved"; inspoState.author = "";
      $("#journal").hidden = true;
      if (location.hash === "#inspiration") renderInspiration(); // no hashchange when already there
    }
    const q = e.target.closest("[data-save-quote]");
    if (q) {
      toggleSaveQuote(q.dataset.saveQuote);
      if (isQuoteSaved(q.dataset.saveQuote)) savedToast();
      if (location.hash === "#inspiration" && q.closest(".passage")) renderInspiration();
      return;
    }
    const b = e.target.closest("[data-save-poem]");
    if (!b) return;
    toggleSavePoem(b.dataset.savePoem);
    if (isSaved(b.dataset.savePoem)) savedToast();
    if (location.hash === "#inspiration" && b.closest(".passage")) renderInspiration();
  });

  async function renderPoem(author, title, word) {
    document.title = `${title} · Word World`;
    $("#q").value = "";
    const id = poemId({ author, title });
    app.innerHTML = `
      <article class="reader">
        <p class="back"><a href="#inspiration" id="back">← Back</a></p>
        <h1 class="poem-title">${esc(title)}</h1>
        <p class="byline">${esc(author)}</p>
        <div class="reader-actions">
          <button type="button" class="save" data-save-poem="${esc(id)}"></button>
        </div>
        <div class="poem-body"><p class="loading">Opening the poem…</p></div>
        <p class="hint">Tap any word to look it up.</p>
      </article>`;
    $("#back").addEventListener("click", (e) => {
      if (history.length > 1) { e.preventDefault(); history.back(); }
    });

    let poem = store.get("poems", {})[id] || poemCache[id];
    if (!poem) {
      try {
        const res = await getJSON(`${POETRY}/title/${encodeURIComponent(title)}:abs/author,title,lines`, 20000);
        const list = Array.isArray(res) ? res : [];
        poem = list.find((p) => p.author === author) || list[0];
        if (poem) poemCache[id] = { author, title, lines: poem.lines };
      } catch { /* shown below */ }
    }
    if (!location.hash.startsWith("#poem/")) return; // navigated away while loading
    const body = $(".poem-body");
    if (!poem) {
      body.innerHTML = empty("Couldn't open this poem just now. Try again in a moment.");
      return;
    }
    const btn = $(".reader-actions .save");
    btn.textContent = saveLabel(id);
    btn.classList.toggle("on", isSaved(id));
    const markRe = word ? new RegExp(`^${reEsc(word)}(?:s|es|d|ed|ing)?$`, "i") : null;
    body.innerHTML = poem.lines.map((l) => l.trim()
      ? `<span>${linkWords(l, markRe)}</span>`
      : `<span class="stanza-break"></span>`).join("");
    const first = body.querySelector("mark");
    if (first) first.scrollIntoView({ block: "center" });
  }

  // ---------- PoetryDB: famous lines ----------
  // Matches the word and its common endings: ember, embers; wander, wanders, wandered, wandering.
  const formsRe = (word, flags = "i") => new RegExp(`\\b(${reEsc(word)}(?:s|es|d|ed|ing)?)\\b`, flags);

  async function poems(word) {
    const fetchLines = (w) => getJSON(`${POETRY}/lines/${encodeURIComponent(w)}/author,title,lines`, 20000)
      .then((d) => (Array.isArray(d) ? d : []), () => []);
    const [a, b] = await Promise.all([fetchLines(word), word.endsWith("s") ? [] : fetchLines(word + "s")]);
    const seen = new Set();
    const data = [...a, ...b].filter((p) => !seen.has(p.title + p.author) && seen.add(p.title + p.author));
    const re = formsRe(word);
    const out = [];
    for (const p of data) {
      const i = p.lines.findIndex((l) => re.test(l));
      if (i === -1) continue;
      const lines = p.lines.slice(Math.max(0, i - 1), i + 2).filter((l) => l.trim());
      poemCache[poemId(p)] = { author: p.author, title: p.title, lines: p.lines };
      out.push({ author: p.author, title: p.title, lines, match: p.lines[i] });
    }
    // Prefer well-known poets first, then shuffle lightly so repeat visits show new lines.
    const famous = /Shakespeare|Dickinson|Keats|Shelley|Wordsworth|Byron|Blake|Whitman|Tennyson|Browning|Yeats|Rossetti|Poe|Frost|Donne|Milton|Coleridge|Hopkins|Hardy|Wilde|Kipling|Burns|Longfellow/;
    out.sort((a, b) => (famous.test(b.author) - famous.test(a.author)) || (Math.random() - 0.5));
    return out.slice(0, 12);
  }

  // ---------- the library: "From writers you love" ----------
  // data/lib/books.json lists the public-domain books (Project Gutenberg); data/lib/<prefix>.json maps
  // each word to up to six passages [bookIndex, text, "p" prose | "v" verse], spread across authors.
  // Rebuild with tools/build_library.py after editing tools/books.py.
  let libBooks;
  const libShards = {};
  const libShard = (w) => (libShards[shardKey(w)] ||= getJSON(`data/lib/${shardKey(w)}.json`).catch(() => ({})));

  async function library(word, lemma) {
    libBooks ||= getJSON("data/lib/books.json").then((list) =>
      list.map(([id, author, title, year]) => ({ id, author, title, year })));
    const books = await libBooks;
    const forms = [...new Set([word, lemma, word.endsWith("s") ? null : word + "s"].filter(Boolean))];
    const found = (await Promise.all(forms.map(async (f) => (await libShard(f))[f] || []))).flat();
    // Up to 8 passages, one per author first, then any others.
    const items = [], seen = new Set(), authors = new Set();
    for (const pass of [true, false]) {
      for (const [bi, text, kind] of found) {
        const b = books[bi];
        if (items.length >= 8 || seen.has(text) || (pass && authors.has(b.author))) continue;
        items.push([b, text, kind]); seen.add(text); authors.add(b.author);
      }
    }
    return { items, forms };
  }

  // The writers you love: used to order quotes and for the "See it in their books" searches.
  const DEFAULT_WRITERS = ["Sylvia Plath", "Clarice Lispector", "Toni Morrison", "Ernest Hemingway",
    "Vladimir Nabokov", "Cormac McCarthy", "Anne Carson", "Madeline Cash"];
  const favWriters = () => store.get("writers", DEFAULT_WRITERS);
  const setFavWriters = (list) => store.set("writers", [...new Set(list)]);

  // Short quotations by writers (from Wikiquote): data/quotes/<prefix>.json = { word: [[authorIndex, text, source]] }.
  let quoteAuthors;
  const quoteShards = {};
  const quoteShard = (w) => (quoteShards[shardKey(w)] ||= getJSON(`data/quotes/${shardKey(w)}.json`).catch(() => ({})));

  async function writerQuotes(forms) {
    quoteAuthors ||= getJSON("data/quotes/authors.json");
    const authors = await quoteAuthors;
    const all = [...forms, ...forms.filter((f) => !f.endsWith("s")).map((f) => f + "s")];
    const found = (await Promise.all([...new Set(all)].map(async (f) => (await quoteShard(f))[f] || []))).flat()
      .map(([ai, text, source]) => [authors[ai], text, source]);
    const fav = favWriters().map((w) => w.toLowerCase());
    const rank = (a) => { const i = fav.indexOf(a.toLowerCase()); return i === -1 ? 99 : i; };
    found.sort((a, b) => rank(a[0]) - rank(b[0]));
    const items = [], seen = new Set(), authorsSeen = new Set();
    for (const pass of [true, false]) {
      for (const q of found) {
        if (items.length >= 6 || seen.has(q[1]) || (pass && authorsSeen.has(q[0]))) continue;
        items.push(q); seen.add(q[1]); authorsSeen.add(q[0]);
      }
    }
    return items;
  }

  // Passages in the Inspiration tab that use the word: the starter set, ones you added, and ones you saved.
  function myPassages(forms) {
    const re = new RegExp(`\\b(?:${forms.map(reEsc).join("|")})(?:s|es|d|ed|ing)?\\b`, "i");
    const sources = [
      ...loadInspo().added,
      ...savedItems().map((p) => (p.poem ? { ...p, text: p.poem.lines.join("\n") } : p)),
      ...window.QUILL_PASSAGES,
    ];
    const out = [], seen = new Set();
    for (const p of sources) {
      if (out.length >= 6 || seen.has(p.id) || !re.test(p.text)) continue;
      seen.add(p.id);
      const lines = p.text.split("\n");
      const i = lines.findIndex((l) => re.test(l));
      let text = lines.slice(Math.max(0, i - 1), i + 2).join("\n");
      if (text.length > 420) { // a long prose paragraph: keep just the sentence with the word
        text = (lines[i].match(/[^.!?]+[.!?]+["”’]?/g) || [lines[i]]).find((x) => re.test(x)).trim();
      }
      out.push({ author: p.author, work: p.work, text });
    }
    return out;
  }

  const highlightForms = (text, words) => esc(text).replace(
    new RegExp(`\\b((?:${words.map(reEsc).join("|")})(?:s|es|d|ed|ing)?)\\b`, "gi"), "<mark>$1</mark>");

  // ---------- Wikiquote & Wikisource: full-text search ----------
  // Search snippets come back as HTML with the hit wrapped in <span class="searchmatch">.
  function snippetHTML(raw) {
    const div = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html").body.firstChild;
    let out = "";
    div.childNodes.forEach((c) => {
      if (c.nodeType === 3) out += esc(c.textContent);
      else if (c.classList && c.classList.contains("searchmatch")) out += `<mark>${esc(c.textContent)}</mark>`;
      else out += esc(c.textContent);
    });
    // Wikisource index pages glue long catalogue numbers onto titles ("2348616The Book…").
    return out.replace(/\d{5,}/g, " ").replace(/\s+/g, " ").trim();
  }

  async function wikiSearch(host, word, limit) {
    const url = `https://${host}/w/api.php?` + new URLSearchParams({
      action: "query", list: "search", srsearch: `"${word}"`, srlimit: String(limit),
      srprop: "snippet", srnamespace: "0", format: "json", origin: "*",
    });
    const data = await getJSON(url);
    return ((data.query && data.query.search) || [])
      .map((r) => ({ title: r.title, html: snippetHTML(r.snippet), url: `https://${host}/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}` }))
      .filter((r) => r.html.includes("<mark>"));
  }

  // ---------- rendering ----------
  function highlight(line, word) {
    return esc(line).replace(formsRe(word, "gi"), "<mark>$1</mark>");
  }

  function section(id, title, sub) {
    return `<section class="card" id="${id}">
      <h2>${title}${sub ? ` <small>${sub}</small>` : ""}</h2>
      <div class="body"><p class="loading">Gathering…</p></div>
    </section>`;
  }

  function fill(id, html) {
    const el = document.querySelector(`#${id} .body`);
    if (el) el.innerHTML = html;
  }

  const empty = (msg) => `<p class="muted">${msg}</p>`;
  const chips = (list) => `<div class="chips">${list.map(wordLink).join("")}</div>`;

  function renderHome() {
    document.title = "Word World";
    const list = window.QUILL_WORDS;
    const day = Math.floor(Date.now() / 86400000);
    const wotd = list[day % list.length];
    const recent = store.get("recent", []);
    app.innerHTML = `
      <section class="hero">
        <p class="eyebrow">Word of the day</p>
        <h1><a href="#/${encodeURIComponent(wotd)}">${esc(wotd)}</a></h1>
        <p class="lede">Look up any word to see where it came from, what it means, what it rhymes with
        (sorted by syllable), its kin and its opposites, and where the poets have used it.</p>
      </section>
      ${(() => {
        const ps = window.QUILL_PASSAGES, q = ps[day % ps.length];
        return `<section class="card daily-passage"><h2>Today's passage</h2>
          <blockquote>${q.text.split("\n").map((l) => `<span>${linkWords(l)}</span>`).join("")}</blockquote>
          <p class="byline">— ${esc(q.author)}, <cite>${esc(q.work)}</cite></p>
          <p class="src"><a href="#inspiration">More in Inspiration →</a></p></section>`;
      })()}
      ${recent.length ? `<section class="card"><h2>Recently looked up</h2>${chips(recent)}</section>` : ""}
      <section class="card"><h2>Words worth knowing</h2>
        ${chips([...list].sort(() => Math.random() - 0.5).slice(0, 24))}
      </section>`;
  }

  async function renderWord(raw) {
    const word = raw.trim().toLowerCase();
    if (!word) return renderHome();
    document.title = `${word} · Word World`;
    $("#q").value = word;

    const recent = [word, ...store.get("recent", []).filter((w) => w !== word)].slice(0, 16);
    store.set("recent", recent);

    app.innerHTML = `
      <section class="word-head">
        <div>
          <h1 class="word">${esc(word)}</h1>
          <p class="pron" id="pron"></p>
        </div>
        <button id="save" class="save" type="button"></button>
      </section>
      <nav class="jump">
        <a href="#/${encodeURIComponent(word)}" data-jump="defs">Meaning</a>
        <a href="#/${encodeURIComponent(word)}" data-jump="etym">Origin</a>
        <a href="#/${encodeURIComponent(word)}" data-jump="rhymes">Rhymes</a>
        <a href="#/${encodeURIComponent(word)}" data-jump="syn">Synonyms</a>
        <a href="#/${encodeURIComponent(word)}" data-jump="ant">Antonyms</a>
        <a href="#/${encodeURIComponent(word)}" data-jump="pair">Pairings</a>
        <a href="#/${encodeURIComponent(word)}" data-jump="lit">In literature</a>
      </nav>
      <div class="grid">
        ${section("defs", "Meaning")}
        ${section("etym", "Origin", "etymology")}
        ${section("rhymes", "Rhymes", "grouped by syllables")}
        ${section("syn", "Synonyms", "&amp; kindred words")}
        ${section("ant", "Antonyms")}
        ${section("pair", "Pairings", "how writers dress it")}
        ${section("lit", "In literature", "poems, books &amp; famous writers")}
        <section class="card practice" id="practice">
          <h2>Make it yours</h2>
          <p class="hint">Write one line using <em>${esc(word)}</em>. It goes into your journal with the word.</p>
          <textarea id="line" rows="3" placeholder="The ${esc(word)}…"></textarea>
          <button id="keep" type="button">Keep this line</button>
          <p id="kept" class="muted" aria-live="polite"></p>
        </section>
      </div>`;

    setupSave(word);
    app.querySelectorAll("[data-jump]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById(a.dataset.jump).scrollIntoView({ behavior: "smooth", block: "start" });
      }));

    const current = () => decodeURIComponent(location.hash.slice(2)).toLowerCase() === word;
    const guard = (fn) => (v) => { if (current()) fn(v); };
    const fail = (id) => () => { if (current()) fill(id, empty("Couldn't reach the source just now. Try again in a moment.")); };

    // Meaning + syllables + stress
    datamuse({ sp: word, qe: "sp", md: "dpsr", max: 1 }).then(guard((res) => {
      const info = res.find((r) => r.word.toLowerCase() === word);
      if (!info) return fill("defs", empty("No definition found. Check the spelling, or try the word's base form."));
      const pattern = stressPattern(info.tags);
      if (pattern) {
        const foot = meterName(pattern);
        $("#pron").insertAdjacentHTML("beforeend",
          `<span class="syll">${info.numSyllables} syllable${info.numSyllables === 1 ? "" : "s"}</span>
           <span class="meter" title="Stress pattern">${pattern.map((s) => `<i class="${s}"></i>`).join("")}</span>
           ${foot ? `<span class="foot-name">${foot}</span>` : ""}`);
      }
      const byPos = {};
      (info.defs || []).forEach((d) => {
        const [pos, text] = d.split("\t");
        (byPos[POS[pos] || pos] ||= []).push(text.trim());
      });
      const html = Object.entries(byPos).map(([pos, defs]) =>
        `<h3>${esc(pos)}</h3><ol>${defs.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>`).join("");
      fill("defs", html || empty("No definition found."));
    })).catch(fail("defs"));

    // Origin + IPA: the bundled dictionary first, live Wiktionary only for words it lacks.
    const local = bundled(word);
    const wikiLink = (w) => `<p class="src"><a href="https://en.wiktionary.org/wiki/${encodeURIComponent(w)}#English" target="_blank" rel="noopener">Read more on Wiktionary →</a></p>`;
    local.then(guard((loc) => {
      if (loc && loc.i) $("#pron").insertAdjacentHTML("afterbegin", `<span class="ipa">${esc(loc.i)}</span>`);
      if (loc && loc.e) {
        const form = loc.formOf ? `<p class="muted">“${esc(word)}” is a form of <a href="#/${encodeURIComponent(loc.formOf)}">${esc(loc.formOf)}</a>.</p>` : "";
        const many = loc.e.length > 1;
        return fill("etym", form + loc.e.map((t, n) =>
          `<div class="etym-block">${many ? `<span class="etym-n">${n + 1}</span>` : ""}${etymHTML(t)}</div>`).join("") + wikiLink(loc.word));
      }
      liveOrigin();
    })).catch(guard(() => liveOrigin()));

    const liveOrigin = () => wiktionary(word).then(guard((w) => {
      if (w && (w.ipa || w.hyphenation)) {
        $("#pron").insertAdjacentHTML("afterbegin",
          `${w.ipa && !$("#pron .ipa") ? `<span class="ipa">${esc(w.ipa)}</span>` : ""}${w.hyphenation ? `<span class="hyph">${esc(w.hyphenation)}</span>` : ""}`);
      }
      if (!w || !w.etymology.length) return fill("etym", empty("No etymology recorded for this word."));
      fill("etym", w.etymology.map((p) => `<p>${p}</p>`).join("") + wikiLink(word));
    })).catch(fail("etym"));

    // Rhymes, grouped by syllable count
    Promise.all([
      datamuse({ rel_rhy: word, md: "s", max: 400 }),
      datamuse({ rel_nry: word, md: "s", max: 200 }),
    ]).then(guard(([perfect, near]) => renderRhymes(perfect, near))).catch(fail("rhymes"));

    // Synonyms
    Promise.all([
      datamuse({ rel_syn: word, max: 60 }),
      datamuse({ ml: word, max: 40 }),
    ]).then(guard(([syn, ml]) => {
      const seen = new Set(syn.map((s) => s.word));
      const kin = ml.filter((m) => !seen.has(m.word) && m.word !== word && !/\s/.test(m.word)).slice(0, 24);
      fill("syn",
        (syn.length ? chips(syn.map((s) => s.word)) : empty("No direct synonyms.")) +
        (kin.length ? `<h3>Close in meaning</h3>${chips(kin.map((s) => s.word))}` : ""));
    })).catch(fail("syn"));

    // Antonyms
    datamuse({ rel_ant: word, max: 40 }).then(guard((ant) => {
      fill("ant", ant.length ? chips(ant.map((a) => a.word)) : empty("No antonyms on record."));
    })).catch(fail("ant"));

    // Pairings: adjectives used for this noun, and nouns this adjective describes.
    // Words rarer than 0.05 per million are almost always corpus noise here.
    const common = (list) => list.filter((w) => {
      const f = (w.tags || []).find((t) => t.startsWith("f:"));
      return !f || parseFloat(f.slice(2)) >= 0.05;
    }).slice(0, 24);
    Promise.all([
      datamuse({ rel_jjb: word, md: "f", max: 40 }).then(common),
      datamuse({ rel_jja: word, md: "f", max: 40 }).then(common),
    ]).then(guard(([adjs, nouns]) => {
      let html = "";
      if (adjs.length) html += `<h3>Words that describe it</h3><p class="phrases">${adjs.map((a) => `<a href="#/${encodeURIComponent(a.word)}">${esc(a.word)}</a> ${esc(word)}`).join(" · ")}</p>`;
      if (nouns.length) html += `<h3>Things it describes</h3><p class="phrases">${nouns.map((n) => `${esc(word)} <a href="#/${encodeURIComponent(n.word)}">${esc(n.word)}</a>`).join(" · ")}</p>`;
      fill("pair", html || empty("No common pairings found."));
    })).catch(fail("pair"));

    // Literature
    // Literature: first the curated library, then the older archives, which load only when opened.
    fill("lit", `<div id="lit-mine"></div><div id="lit-quotes"></div>
      <div id="lit-library"><p class="loading">Searching the library…</p></div>
      <div id="lit-search"></div>
      <details id="lit-archive" class="archive">
        <summary>More from the archives <small>older poems you can save and read in full, dictionary quotations, Wikiquote, Wikisource</small></summary>
        <div id="lit-poems"></div><div id="lit-books"></div><div id="lit-writers"></div><div id="lit-classics"></div>
        <p class="loading" id="lit-loading">Searching the poets and the libraries…</p>
      </details>`);
    const group = (id, title, items) => {
      const el = document.getElementById(id);
      if (el && items.length) el.innerHTML = `<div class="lit-group"><h3>${title}</h3><div class="quotes">${items.join("")}</div></div>`;
      return items.length;
    };
    const figure = (body, caption) => `<figure class="quote"><blockquote>${body}</blockquote><figcaption>${caption}</figcaption></figure>`;
    const prettyTitle = (t) => esc(t.replace(/\//g, " · "));

    const saveBtn = (id) =>
      `<button type="button" data-save-quote="${esc(id)}" class="${isQuoteSaved(id) ? "on" : ""}">${quoteLabel(id)}</button>`;
    const asVerse = (text, forms) => text.split("\n").map((l) => `<span>${highlightForms(l, forms)}</span>`).join("");
    // Open the archives by themselves only when none of the first three sources has anything.
    let found = 0, pending = 3;
    const settle = (n) => { found += n || 0; if (--pending === 0 && !found) $("#lit-archive").open = true; };

    local.then((loc) => {
      const forms = [...new Set([word, loc && loc.formOf].filter(Boolean))];

      // 1. Passages already in the Inspiration tab (yours, saved, and the starter set).
      settle(group("lit-mine", "Your passages", myPassages(forms).map((p) => figure(asVerse(p.text, forms),
        `${esc(p.author)}${p.work ? `, <cite>${esc(p.work)}</cite>` : ""} · <a href="#inspiration">in Inspiration</a>`))));

      // 2. Short quotations from your writers (Wikiquote), favourites first.
      writerQuotes(forms).then(guard((items) => settle(group("lit-quotes", "Your writers", items.map(([author, text, source]) => {
        const id = quoteId(text);
        const url = `https://en.wikiquote.org/wiki/${encodeURIComponent(author.replace(/ /g, "_"))}`;
        quoteCache[id] = { author, work: source, text, url, linkLabel: "More on Wikiquote →" };
        return figure(asVerse(text, forms),
          `${esc(author)}${source ? `, <cite>${esc(source)}</cite>` : ""}
           <span class="poem-actions"><a href="${url}" target="_blank" rel="noopener">More on Wikiquote →</a>${saveBtn(id)}</span>`);
      }))))).catch(() => settle(0));

      // 3. The free library (whole public-domain books).
      return library(word, loc && loc.formOf);
    }).then(guard(({ items, forms }) => {
      const n = group("lit-library", "From the library", items.map(([b, text, kind]) => {
        const id = quoteId(text);
        const url = `https://www.gutenberg.org/ebooks/${b.id}`;
        quoteCache[id] = { author: b.author, work: b.title, year: b.year, text, url };
        return figure(kind === "v" ? asVerse(text, forms) : highlightForms(text, forms),
          `${esc(b.author)}, <cite>${esc(b.title)}</cite> (${b.year})
           <span class="poem-actions"><a href="${url}" target="_blank" rel="noopener">Read the book →</a>${saveBtn(id)}</span>`);
      }));
      if (!n) $("#lit-library").innerHTML = "";
      settle(n);
    })).catch(guard(() => { $("#lit-library").innerHTML = ""; settle(0); }));

    // 4. One-tap searches inside each favourite writer's real books.
    const drawSearch = () => {
      const el = document.getElementById("lit-search");
      if (!el) return;
      el.innerHTML = `<div class="lit-group"><h3>See it in their books</h3>
        <p class="hint">Opens Google Books searching for “${esc(word)}” inside each writer’s books, with real sentences in context.</p>
        <div class="chips writers">${favWriters().map((w) => `<span class="writer">
            <a class="chip" target="_blank" rel="noopener"
               href="https://www.google.com/search?tbm=bks&q=${encodeURIComponent(`"${word}" inauthor:"${w}"`)}">${esc(w)} ↗</a>
            <button type="button" class="quiet" data-remove-writer="${esc(w)}" aria-label="Remove ${esc(w)}">×</button></span>`).join("")}
          <button type="button" class="ghost small" id="add-writer">+ Add a writer</button></div></div>`;
      $("#add-writer").addEventListener("click", () => {
        const name = (prompt("Writer’s name, as it appears on their books:") || "").trim();
        if (name) { setFavWriters([...favWriters(), name]); drawSearch(); }
      });
      el.querySelectorAll("[data-remove-writer]").forEach((b) => b.addEventListener("click", () => {
        setFavWriters(favWriters().filter((w) => w !== b.dataset.removeWriter)); drawSearch();
      }));
    };
    drawSearch();

    let archiveLoaded = false;
    const loadArchive = () => {
      if (archiveLoaded) return;
      archiveLoaded = true;
      Promise.all([
        poems(word).then(guard((list) => group("lit-poems", "In poems", list.map((p) => {
          const id = poemId(p);
          return figure(p.lines.map((l) => `<span>${highlight(l, word)}</span>`).join(""),
            `${esc(p.author)}, <cite>${esc(p.title)}</cite>
             <span class="poem-actions">
               <a href="${poemHref(p, word)}">Read in full →</a>
               <button type="button" data-save-poem="${esc(id)}" class="${isSaved(id) ? "on" : ""}">${saveLabel(id)}</button>
             </span>`);
        })))).catch(() => 0),
        local.then(async (loc) => {
          if (loc && loc.q) return loc.q.map(([text, cite]) => figure(highlight(text, loc.word), esc(cite)));
          const w = await wiktionary(word);
          return ((w && w.quotes) || []).map((q) => figure(q.text, esc(q.cite)));
        }).then(guard((items) => group("lit-books", "Quoted in books", items))).catch(() => 0),
        wikiSearch("en.wikiquote.org", word, 10).then(guard((list) => group("lit-writers", "Famous writers", list.map((r) =>
          figure(`…${r.html}…`, `<a href="${r.url}" target="_blank" rel="noopener">${prettyTitle(r.title)}</a>`))))).catch(() => 0),
        wikiSearch("en.wikisource.org", word, 10).then(guard((list) => group("lit-classics", "Classic texts", list.map((r) =>
          figure(`…${r.html}…`, `<a href="${r.url}" target="_blank" rel="noopener"><cite>${prettyTitle(r.title)}</cite></a>`))))).catch(() => 0),
      ]).then(guard((counts) => {
        const loading = document.getElementById("lit-loading");
        if (!loading) return;
        if (counts.some(Boolean)) loading.remove();
        else loading.outerHTML = empty("No literary uses found for this word. Try a related form or a synonym.");
      }));
    };
    $("#lit-archive").addEventListener("toggle", () => { if ($("#lit-archive").open) loadArchive(); });

    // Practice line
    const existing = store.get("journal", {})[word];
    if (existing?.lines?.length) $("#kept").textContent = `${existing.lines.length} line(s) already in your journal.`;
    $("#keep").addEventListener("click", () => {
      const text = $("#line").value.trim();
      if (!text) return;
      const j = store.get("journal", {});
      j[word] ||= { added: Date.now(), lines: [] };
      j[word].lines.push(text);
      store.set("journal", j);
      $("#line").value = "";
      $("#kept").textContent = "Kept. ✦";
      setupSave(word);
      updateJournalCount();
    });
  }

  function renderRhymes(perfect, near) {
    const group = (list) => {
      const g = {};
      list.forEach((r) => {
        const n = r.numSyllables || r.word.split(/[\s-]+/).length;
        const key = n >= 4 ? "4+" : String(n);
        (g[key] ||= []).push(r);
      });
      return g;
    };
    const keys = ["1", "2", "3", "4+"];
    const state = { kind: "perfect", syl: "all", phrases: false };
    const lists = { perfect, near };
    const el = document.querySelector("#rhymes .body");

    const draw = () => {
      let list = lists[state.kind].filter((r) => state.phrases || !/\s/.test(r.word));
      const g = group(list);
      const tabs = ["all", ...keys].map((k) => {
        const count = k === "all" ? list.length : (g[k] || []).length;
        return `<button type="button" data-syl="${k}" class="${state.syl === k ? "on" : ""}" ${count ? "" : "disabled"}>${k === "all" ? "All" : k + " syl"} <span>${count}</span></button>`;
      }).join("");
      let body;
      if (state.syl === "all") {
        body = keys.filter((k) => g[k]).map((k) =>
          `<h3>${k} syllable${k === "1" ? "" : "s"}</h3>${chips(g[k].slice(0, 60).map((r) => r.word))}`).join("");
      } else {
        body = chips((g[state.syl] || []).map((r) => r.word));
      }
      el.innerHTML = `
        <div class="toolbar">
          <div class="seg">
            <button type="button" data-kind="perfect" class="${state.kind === "perfect" ? "on" : ""}">Perfect</button>
            <button type="button" data-kind="near" class="${state.kind === "near" ? "on" : ""}">Near / slant</button>
          </div>
          <label class="toggle"><input type="checkbox" ${state.phrases ? "checked" : ""}> phrases</label>
        </div>
        <div class="tabs">${tabs}</div>
        ${body || empty(state.kind === "perfect" ? "No perfect rhymes. Try near rhymes: poets use them all the time." : "No near rhymes found.")}`;
      el.querySelectorAll("[data-syl]").forEach((b) => b.addEventListener("click", () => { state.syl = b.dataset.syl; draw(); }));
      el.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { state.kind = b.dataset.kind; state.syl = "all"; draw(); }));
      el.querySelector(".toggle input").addEventListener("change", (e) => { state.phrases = e.target.checked; draw(); });
    };
    draw();
  }

  // ---------- journal ----------
  function setupSave(word) {
    const btn = $("#save");
    if (!btn) return;
    const saved = !!store.get("journal", {})[word];
    btn.textContent = saved ? "★ In journal" : "☆ Save word";
    btn.classList.toggle("on", saved);
    btn.onclick = () => {
      const j = store.get("journal", {});
      if (j[word]) {
        if (j[word].lines.length && !confirm(`Remove "${word}" and your lines from the journal?`)) return;
        delete j[word];
      } else {
        j[word] = { added: Date.now(), lines: [] };
      }
      store.set("journal", j);
      setupSave(word);
      updateJournalCount();
    };
  }

  function updateJournalCount() {
    const n = Object.keys(store.get("journal", {})).length;
    $("#journal-count").textContent = n ? n : "";
  }

  function renderJournal() {
    const j = store.get("journal", {});
    const entries = Object.entries(j).sort((a, b) => b[1].added - a[1].added);
    const n = savedCount();
    $("#journal-saved").innerHTML = `<a href="#inspiration" data-open-saved>🔖 Saved poems &amp; passages${n ? ` (${n})` : ""} →</a>`;
    $("#journal-list").innerHTML = entries.length
      ? entries.map(([w, e]) => `
          <div class="entry">
            <a href="#/${encodeURIComponent(w)}">${esc(w)}</a>
            ${e.lines.map((l) => `<p>“${esc(l)}”</p>`).join("")}
          </div>`).join("")
      : empty("Nothing saved yet. Tap ☆ on any word to keep it here.");
  }

  const journal = $("#journal");
  $("#journal-btn").addEventListener("click", () => { renderJournal(); journal.hidden = !journal.hidden; });
  $("#journal-close").addEventListener("click", () => { journal.hidden = true; });
  $("#journal-list").addEventListener("click", (e) => { if (e.target.closest("a")) journal.hidden = true; });

  // ---------- inspiration ----------
  // Saved under "quill:inspo": { liked: {id: true}, added: [passage], notes: {id: [note]} }
  // A note is { id, kind: "comment" | "response", text, at }.
  const inspoState = { filter: "all", author: "", composing: null };

  const loadInspo = () => {
    const d = store.get("inspo", {});
    return { liked: d.liked || {}, added: d.added || [], notes: d.notes || {} };
  };

  // Every word in a passage is a link to its page, so a phrase that catches you is one tap from its roots.
  // markRe, if given, highlights the words it matches (used to show the looked-up word inside a poem).
  const linkWords = (text, markRe) => text.split(/(\p{L}[\p{L}’'-]*\p{L}|\p{L})/u).map((t, i) => {
    if (i % 2 === 0) return esc(t);
    const a = `<a class="w" href="#/${encodeURIComponent(t.toLowerCase().replace(/[’']s$/, ""))}">${esc(t)}</a>`;
    return markRe && markRe.test(t) ? `<mark>${a}</mark>` : a;
  }).join("");

  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  function renderInspiration() {
    document.title = "Inspiration · Word World";
    $("#q").value = "";
    const data = loadInspo();
    const all = [...data.added.map((p) => ({ ...p, mine: true })), ...savedItems(), ...window.QUILL_PASSAGES];
    const authors = [...new Set(all.map((p) => p.author))].sort((a, b) =>
      a.split(" ").pop().localeCompare(b.split(" ").pop()));
    const f = inspoState.filter;
    const shown = all.filter((p) =>
      (!inspoState.author || p.author === inspoState.author) &&
      (f === "all" ||
       (f === "liked" && data.liked[p.id]) ||
       (f === "mine" && p.mine) ||
       (f === "saved" && (p.poem || p.quote)) ||
       (f === "writing" && (data.notes[p.id] || []).length)));

    const filters = [["all", "All"], ["liked", "♥ Loved"], ["writing", "✎ With my writing"], ["saved", `🔖 Saved${savedCount() ? ` (${savedCount()})` : ""}`], ["mine", "Added by me"]];
    app.innerHTML = `
      <section class="hero small">
        <p class="eyebrow">Inspiration</p>
        <h1>Sentences that sing</h1>
        <p class="lede">Read slowly. Love the ones that stop you, leave a note on why, and answer them with
        something of your own. Tap any word to see where it comes from.</p>
      </section>
      <div class="inspo-bar">
        <div class="seg">${filters.map(([k, label]) =>
          `<button type="button" data-filter="${k}" class="${f === k ? "on" : ""}">${label}</button>`).join("")}</div>
        <select id="author-filter" aria-label="Author">
          <option value="">All writers</option>
          ${authors.map((a) => `<option ${a === inspoState.author ? "selected" : ""}>${esc(a)}</option>`).join("")}
        </select>
        <button type="button" id="add-passage" class="ghost">+ Add a passage</button>
      </div>
      <form id="passage-form" class="card add-form" hidden>
        <h2>Add a passage you love</h2>
        <textarea name="text" rows="5" required placeholder="Paste or type the passage…"></textarea>
        <div class="row">
          <input name="author" required placeholder="Author" list="author-list">
          <input name="work" placeholder="Book, poem or essay">
          <datalist id="author-list">${authors.map((a) => `<option value="${esc(a)}">`).join("")}</datalist>
        </div>
        <button type="submit">Add to Inspiration</button>
      </form>
      <div class="passages">
        ${shown.length ? shown.map((p) => passageCard(p, data)).join("") :
          empty(f === "liked" ? "Nothing loved yet. Tap ♡ on a passage that stops you." :
                f === "writing" ? "You haven't written back to any passage yet." :
                f === "saved" ? "Nothing saved yet. On any word’s page, tap “☆ Save” under a passage in In literature, or “☆ Save poem” under a poem in the archives." :
                f === "mine" ? "Add a passage from a book you love with “+ Add a passage”." : "No passages.")}
      </div>`;

    app.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
      inspoState.filter = b.dataset.filter; renderInspiration();
    }));
    $("#author-filter").addEventListener("change", (e) => { inspoState.author = e.target.value; renderInspiration(); });
    $("#add-passage").addEventListener("click", () => {
      const form = $("#passage-form"); form.hidden = !form.hidden;
      if (!form.hidden) form.text.focus();
    });
    $("#passage-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const d = loadInspo();
      d.added.unshift({
        id: "mine-" + Date.now().toString(36),
        author: form.author.value.trim(), work: form.work.value.trim(), text: form.text.value.trim(),
      });
      store.set("inspo", d);
      renderInspiration();
    });
  }

  // Saved poems appear in Inspiration as their opening lines, with a link to read them whole.
  const savedCount = () => Object.keys(store.get("poems", {})).length + Object.keys(store.get("quotes", {})).length;

  // Saved poems and saved library passages, newest first.
  function savedItems() {
    const quotes = Object.entries(store.get("quotes", {})).map(([id, q]) =>
      ({ id, author: q.author, work: q.work, year: q.year, text: q.text, quote: q, at: q.savedAt }));
    const poems = savedPoemPassages().map((p) => ({ ...p, at: p.poem.savedAt }));
    return [...quotes, ...poems].sort((a, b) => b.at - a.at);
  }

  function savedPoemPassages() {
    return Object.entries(store.get("poems", {}))
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .map(([id, poem]) => {
        const lines = poem.lines.filter((l) => l.trim() && l !== l.toUpperCase()); // skip headings in the preview
        const opening = lines.slice(0, 6).join("\n") + (lines.length > 6 ? "\n…" : "");
        return { id, author: poem.author, work: poem.title, text: opening, poem };
      });
  }

  function passageCard(p, data) {
    const notes = data.notes[p.id] || [];
    const liked = !!data.liked[p.id];
    const composing = inspoState.composing && inspoState.composing.id === p.id ? inspoState.composing.kind : null;
    return `
      <article class="passage card" data-id="${esc(p.id)}">
        <blockquote>${p.text.split("\n").map((l) => `<span>${linkWords(l)}</span>`).join("")}</blockquote>
        <p class="byline">— ${esc(p.author)}${p.work ? `, <cite>${esc(p.work)}</cite>` : ""}${p.year ? ` (${p.year})` : ""}</p>
        <div class="actions">
          <button type="button" data-act="like" class="like ${liked ? "on" : ""}" aria-pressed="${liked}">${liked ? "♥ Loved" : "♡ Love"}</button>
          <button type="button" data-act="comment" class="${composing === "comment" ? "on" : ""}">💬 Note</button>
          <button type="button" data-act="response" class="${composing === "response" ? "on" : ""}">✎ Write back</button>
          ${p.mine ? `<button type="button" data-act="remove" class="quiet">Remove</button>` : ""}
          ${p.poem ? `<a class="read-full" href="${poemHref(p.poem)}">Read the whole poem →</a>
            <button type="button" class="quiet" data-save-poem="${esc(p.id)}">★ Saved</button>` : ""}
          ${p.quote ? `<a class="read-full" href="${esc(p.quote.url)}" target="_blank" rel="noopener">${esc(p.quote.linkLabel || "Read the book →")}</a>
            <button type="button" class="quiet" data-save-quote="${esc(p.id)}">★ Saved</button>` : ""}
        </div>
        ${composing ? `
          <div class="composer">
            <textarea rows="${composing === "response" ? 6 : 3}" placeholder="${composing === "response"
              ? "Write your own piece in answer: borrow its rhythm, its image, its mood…"
              : "What stops you here? A word, a sound, a turn?"}"></textarea>
            <div class="row">
              <button type="button" data-act="save-note">${composing === "response" ? "Attach my writing" : "Add note"}</button>
              <button type="button" data-act="cancel" class="quiet">Cancel</button>
            </div>
          </div>` : ""}
        ${notes.length ? `<div class="thread">${notes.map((n) => `
          <div class="note ${n.kind}" data-note="${esc(n.id)}">
            <p class="note-meta">${n.kind === "response" ? "My writing" : "Note"} · ${fmtDate(n.at)}
              <button type="button" data-act="delete-note" class="quiet" aria-label="Delete">✕</button></p>
            <div class="note-text">${esc(n.text).replace(/\n/g, "<br>")}</div>
          </div>`).join("")}</div>` : ""}
      </article>`;
  }

  // One delegated handler for every passage card.
  app.addEventListener("click", (e) => {
    const btn = e.target.closest(".passage [data-act]");
    if (!btn) return;
    const card = btn.closest(".passage");
    const id = card.dataset.id;
    const d = loadInspo();
    switch (btn.dataset.act) {
      case "like":
        if (d.liked[id]) delete d.liked[id]; else d.liked[id] = true;
        break;
      case "comment":
      case "response":
        inspoState.composing = { id, kind: btn.dataset.act };
        rerenderCard(card, d);
        app.querySelector(`.passage[data-id="${CSS.escape(id)}"] .composer textarea`).focus();
        return;
      case "cancel":
        inspoState.composing = null;
        break;
      case "save-note": {
        const text = card.querySelector(".composer textarea").value.trim();
        if (!text) return;
        (d.notes[id] ||= []).push({ id: Date.now().toString(36), kind: inspoState.composing.kind, text, at: Date.now() });
        inspoState.composing = null;
        break;
      }
      case "delete-note": {
        const nid = btn.closest(".note").dataset.note;
        if (!confirm("Delete this?")) return;
        d.notes[id] = (d.notes[id] || []).filter((n) => n.id !== nid);
        break;
      }
      case "remove":
        if (!confirm("Remove this passage and everything you wrote on it?")) return;
        d.added = d.added.filter((p) => p.id !== id);
        delete d.notes[id]; delete d.liked[id];
        store.set("inspo", d);
        return renderInspiration();
    }
    store.set("inspo", d);
    rerenderCard(card, d);
  });

  function rerenderCard(card, data) {
    const id = card.dataset.id;
    const p = data.added.find((x) => x.id === id);
    const passage = p ? { ...p, mine: true } :
      savedItems().find((x) => x.id === id) || window.QUILL_PASSAGES.find((x) => x.id === id);
    card.outerHTML = passageCard(passage, data);
  }

  // ---------- workshop: step-by-step editing ----------
  // Saved under "quill:workshop" as [{ id, title, text, original, step, flags: [lineIndex], heart, versions, updatedAt }].
  // One small step on screen at a time; every step can be skipped; everything saves as you go.
  const FILLER = new Set(("very really just quite rather somewhat actually basically simply truly totally completely " +
    "literally definitely certainly perhaps maybe suddenly finally that so even still all some things thing stuff kind sort " +
    "seem seemed seems feel felt feels started began begin").split(" "));
  const ABSTRACT = new Set(("love loved pain soul souls heart hearts beauty beautiful sadness sad happiness happy joy " +
    "emotion emotions feeling feelings life time forever eternity eternal dream dreams hope hopes fear fears truth " +
    "freedom peace hate hatred loneliness lonely despair grief sorrow memory memories passion desire spirit nothing " +
    "everything something world existence reality darkness light infinite destiny fate").split(" "));
  const CLICHES = ["broken heart", "heart of gold", "tears fell", "tears streamed", "deep down", "cold as ice",
    "dark night", "the dead of night", "pitch black", "crystal clear", "time stood still", "frozen in time",
    "soul mate", "a million pieces", "into the abyss", "the void", "shattered", "endless sky", "endless love",
    "eyes like the ocean", "lost in your eyes", "heart skipped a beat", "butterflies in my stomach",
    "like a rose", "red as blood", "white as snow", "silence was deafening", "deafening silence", "at the end of the day",
    "against all odds", "a sea of", "light at the end of the tunnel", "since the dawn of time", "with all my heart",
    "pierced my heart", "fire in my soul", "burning desire", "my everything", "bittersweet", "rollercoaster",
    "heavy heart", "falling apart", "fell apart", "weight of the world", "only time will tell", "stars in the sky"];
  const WEAK_VERBS = new Set("is are was were be been being am has have had got get gets getting there's it's".split(" "));
  const WEAK_ENDINGS = new Set("the a an of and to in on at for with my your his her their our its but or as is was that this from by".split(" "));

  const syllables = (w) => {
    w = w.toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    return Math.max(1, (w.match(/[aeiouy]{1,2}/g) || []).length);
  };
  const wordCount = (t) => (t.match(/[\p{L}’'-]+/gu) || []).length;

  const STEPS = [
    {
      title: "Name the feeling", minutes: 5,
      who: "Audre Lorde, Poetry Is Not a Luxury",
      why: "Lorde wrote that poetry is how we give names to feelings that don’t have names yet. Before fixing any words, find the feeling the words were reaching for.",
      todo: ["Read your draft once, slowly.", "Answer the three questions below. Short answers are best: you'll carry them into a blank page next."],
      tool: "feeling",
    },
    {
      title: "Rewrite from scratch", minutes: 10,
      who: "William Wordsworth · Natalie Goldberg, Writing Down the Bones",
      why: "Your first draft was how you found the feeling. Now that you know it, write the poem again from the feeling, not from the old words, so the old words can’t steer you. Whatever you remember without looking was alive; whatever you forget probably wasn’t needed. Wordsworth called poetry “emotion recollected in tranquillity.” Goldberg’s rules for this kind of writing: keep your hand moving, don’t cross out, don’t think.",
      todo: ["Your old draft is hidden. Only the feeling is here.", "Write the whole thing again, without stopping, for about 10 minutes. Messy is fine.", "Stuck? Start with “It felt like…” and keep going."],
      tool: "rewrite",
    },
    {
      title: "Turn the lens", minutes: 10, optional: true,
      who: "Ursula K. Le Guin, Steering the Craft",
      why: "Le Guin had writers tell the same story from different points of view, because each one shows something the others hide. Moving the camera can make a familiar feeling strange and new again.",
      todo: ["Pick one lens below and rewrite a few lines (or all of it) through it.", "Keep anything that surprises you: paste it into your draft with ✎ Edit, or replace the draft if the new version is better.", "Optional: skip if your rewrite already feels right."],
      tool: "lens",
    },
    {
      title: "Hear it", minutes: 5,
      who: "Ursula K. Le Guin, Steering the Craft",
      why: "Le Guin taught that the sound of writing is where it lives: read it out loud and your ear catches what your eye skims over.",
      todo: ["Press ▶ and listen, or read it out loud yourself.", "Tap every line where you stumbled, got bored, or winced. Don't fix anything yet."],
      tool: "listen",
    },
    {
      title: "Find the heart", minutes: 5,
      who: "Richard Hugo, The Triggering Town",
      why: "Hugo told poets that what starts a poem is often not what the poem is really about. The real subject shows up along the way.",
      todo: ["Tap the one line you'd keep if you could keep only one. That's the heart.", "Ask: does the poem lead toward it, or wander away? Could it start closer to it?"],
      tool: "heart",
    },
    {
      title: "Cut 20%", minutes: 10,
      who: "Stephen King, On Writing · George Orwell",
      why: "King’s rule of thumb is second draft = first draft minus 10%. A poem can go further: aim for a fifth. Orwell: “If it is possible to cut a word out, always cut it out.”",
      todo: ["Highlighted words are often filler. Delete the ones the poem doesn't miss.", "Aim for the target word count. Tap ✎ Edit to change the poem."],
      tool: "cut",
    },
    {
      title: "Show, don't name", minutes: 10,
      who: "Ezra Pound · Natalie Goldberg, Writing Down the Bones",
      why: "Pound: “Go in fear of abstractions.” Goldberg’s advice is to be specific: not “fruit” but the actual fruit. Feelings land through things you can see, hear, touch.",
      todo: ["Highlighted words name a feeling or an idea.", "Pick one or two. Replace each with an image: what does it look, sound or smell like? Tap a word to look it up."],
      tool: "abstract",
    },
    {
      title: "Fresh, not familiar", minutes: 5,
      who: "George Orwell, Politics and the English Language",
      why: "Orwell warned against any figure of speech “you are used to seeing in print.” A phrase that arrives too easily is usually someone else’s.",
      todo: ["Highlighted phrases are common clichés.", "Swap each for something only you would notice. If nothing's highlighted, look for phrases you've heard in songs."],
      tool: "cliche",
    },
    {
      title: "Strong verbs", minutes: 5,
      who: "Strunk & White, The Elements of Style",
      why: "“Use the active voice” and lean on verbs: a strong verb can do the work of a verb plus an adverb.",
      todo: ["Highlighted: weak verbs (is, was, had…) and -ly adverbs.", "Change two or three into one vivid verb. “walked slowly” → “drifted”."],
      tool: "verbs",
    },
    {
      title: "Line endings & sound", minutes: 10,
      who: "Mary Oliver, A Poetry Handbook",
      why: "Oliver wrote about the line as a unit of breath: where a line breaks changes what the reader hears and how long they wait.",
      todo: ["Lines ending on small words (the, of, and…) are marked. Try ending on a strong noun or verb.", "Check the syllable counts on the right: wild jumps can be on purpose, or a stumble. Tap an end word to find its rhymes."],
      tool: "lines",
    },
    {
      title: "The edges", minutes: 5,
      who: "a classic workshop test",
      why: "Poems often start a line before they need to and end a line after they should, explaining what the image already said.",
      todo: ["Read it without the first line. Then without the last line.", "If either version is stronger, cut it for real."],
      tool: "edges",
    },
    {
      title: "Title", minutes: 5,
      who: "",
      why: "A title is the first line the reader sees. It can set the scene so the poem doesn't have to, or add a second meaning.",
      todo: ["Try three titles. Keep the one that makes the poem mean a little more."],
      tool: "title",
    },
    {
      title: "Read it once more", minutes: 5,
      who: "",
      why: "Look how far it came. Then decide what this poem wants next.",
      todo: ["Listen to it one last time.", "Compare your first draft with this one."],
      tool: "finish",
    },
  ];

  // Drafts made before the three opening steps existed move forward three steps.
  const wsLoad = () => store.get("workshop", []).map((p) => (p.v2 ? p : { ...p, v2: true, step: p.step > 0 ? p.step + 3 : 0 }));
  const wsSave = (list) => store.set("workshop", list);
  const wsGet = (id) => wsLoad().find((p) => p.id === id);
  function wsUpdate(id, fn) {
    const list = wsLoad();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    fn(p);
    p.updatedAt = Date.now();
    wsSave(list);
    return p;
  }

  function renderWorkshopHome() {
    document.title = "Workshop · Word World";
    $("#q").value = "";
    const list = wsLoad().sort((a, b) => b.updatedAt - a.updatedAt);
    app.innerHTML = `
      <section class="hero small">
        <p class="eyebrow">Workshop</p>
        <h1>Make it better, one step at a time</h1>
        <p class="lede">Thirteen short steps from writers who teach, starting with the feeling. One at a time, about 5–10 minutes each.
        Skip any step, stop anytime: it saves as you go. Tip from Stephen King: let a draft rest
        at least a night first, so you read it like a stranger.</p>
      </section>
      <section class="card ws-new">
        <h2>A new poem or passage</h2>
        <input id="ws-title" placeholder="Title (optional)">
        <textarea id="ws-text" rows="8" placeholder="Paste or type your draft here…"></textarea>
        <button type="button" id="ws-start">Start the workshop →</button>
      </section>
      ${list.length ? `<section class="card"><h2>Your drafts</h2><div class="ws-list">${list.map((p) => `
        <a class="ws-item" href="#workshop/${encodeURIComponent(p.id)}">
          <strong>${esc(p.title || p.text.split("\n")[0].slice(0, 50) || "Untitled")}</strong>
          <span>${p.step >= STEPS.length ? "✓ finished" : `step ${p.step + 1} of ${STEPS.length} · ${esc(STEPS[p.step].title)}`}</span>
        </a>`).join("")}</div></section>` : ""}`;
    $("#ws-start").addEventListener("click", () => {
      const text = $("#ws-text").value.replace(/\s+$/, "");
      if (!text.trim()) return $("#ws-text").focus();
      const id = Date.now().toString(36);
      const list = wsLoad();
      list.push({ id, title: $("#ws-title").value.trim(), text, original: text, step: 0, flags: [], heart: null,
        versions: [{ at: Date.now(), text, label: "First draft" }], updatedAt: Date.now(), v2: true });
      wsSave(list);
      location.hash = "#workshop/" + encodeURIComponent(id);
    });
  }

  let wsEditing = false, wsTimer = null, wsHide = null;

  function renderWorkshop(id) {
    let p = wsGet(id);
    if (!p) { location.hash = "#workshop"; return; }
    document.title = `${p.title || "Draft"} · Workshop · Word World`;
    const n = Math.min(p.step, STEPS.length - 1);
    const s = STEPS[n];
    const done = p.step >= STEPS.length;
    const words = wordCount(p.text);
    const originalWords = wordCount(p.original);
    app.innerHTML = `
      <article class="ws">
        <p class="back"><a href="#workshop">← All drafts</a></p>
        <div class="ws-progress" aria-label="Step ${n + 1} of ${STEPS.length}">${STEPS.map((x, i) =>
          `<button type="button" data-goto="${i}" class="${i < p.step ? "done" : ""} ${i === n ? "now" : ""}" title="${esc(x.title)}"></button>`).join("")}</div>
        ${p.feeling && s.tool !== "feeling" ? `<p class="feeling-banner">The feeling: <strong>${esc(p.feeling)}</strong>${
          p.feelBody ? ` · in my ${esc(p.feelBody)}` : ""}${p.feelImage ? ` · like ${esc(p.feelImage)}` : ""}</p>` : ""}
        <section class="card ws-step">
          <p class="eyebrow">Step ${n + 1} of ${STEPS.length} · about ${s.minutes} min${s.optional ? " · optional" : ""}${done ? " · finished ✓" : ""}</p>
          <h2>${esc(s.title)}</h2>
          <p class="why">${esc(s.why)}${s.who ? ` <span class="who">— ${esc(s.who)}</span>` : ""}</p>
          <ol class="todo">${s.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
          <div class="ws-tool" id="ws-tool"></div>
          <div class="ws-nav">
            <button type="button" class="quiet" id="ws-prev" ${n === 0 ? "disabled" : ""}>← Back</button>
            <button type="button" class="ghost small" id="ws-timer">⏱ 5-minute timer</button>
            <button type="button" class="quiet" id="ws-skip">Skip</button>
            <button type="button" id="ws-next">${n === STEPS.length - 1 ? "Finish ✓" : "Done, next →"}</button>
          </div>
        </section>
        <section class="card ws-poem" ${s.tool === "rewrite" ? "hidden" : ""}>
          <div class="ws-poem-head">
            <h2>${esc(p.title || "Your draft")}</h2>
            <span class="muted">${words} words${originalWords !== words ? ` (was ${originalWords})` : ""}</span>
            <button type="button" class="ghost small" id="ws-edit">${wsEditing ? "Done editing" : "✎ Edit"}</button>
          </div>
          <div id="ws-body"></div>
        </section>
      </article>`;

    const body = $("#ws-body");
    const lines = p.text.split("\n");
    const tool = $("#ws-tool");

    // The poem, with only this step's marks.
    const markLine = (line, i) => {
      const toks = line.split(/([\p{L}’'-]+)/u);
      let html = toks.map((t, k) => {
        if (k % 2 === 0) return esc(t);
        const w = t.toLowerCase().replace(/’/g, "'");
        const link = (cls) => `<a class="${cls}" href="#/${encodeURIComponent(w.replace(/'s$/, ""))}">${esc(t)}</a>`;
        if (s.tool === "cut" && FILLER.has(w)) return `<mark class="hl">${esc(t)}</mark>`;
        if (s.tool === "abstract" && ABSTRACT.has(w)) return link("hl");
        if (s.tool === "verbs" && (WEAK_VERBS.has(w) || (/ly$/.test(w) && w.length > 4 && !["only", "early", "family", "holy", "lonely", "ugly", "belly", "lily", "fly", "july", "reply", "supply", "apply", "rely", "silly", "jelly", "bully", "folly", "melancholy"].includes(w)))) return `<mark class="hl">${esc(t)}</mark>`;
        return esc(t);
      }).join("");
      if (s.tool === "cliche") {
        for (const c of CLICHES) html = html.replace(new RegExp(`\\b(${reEsc(c)})\\b`, "gi"), `<mark class="hl">$1</mark>`);
      }
      if (s.tool === "lines" && line.trim()) {
        const last = (line.match(/[\p{L}’'-]+/gu) || []).pop() || "";
        const weak = WEAK_ENDINGS.has(last.toLowerCase());
        const syl = (line.match(/[\p{L}’'-]+/gu) || []).reduce((a, w) => a + syllables(w), 0);
        html = html.replace(new RegExp(`${reEsc(esc(last))}([^\\p{L}]*)$`, "u"),
          `<a class="${weak ? "hl weak" : "endword"}" href="#/${encodeURIComponent(last.toLowerCase())}">${esc(last)}</a>$1`);
        html += `<span class="syl">${syl}</span>`;
      }
      return html;
    };

    const drawPoem = () => {
      if (wsEditing) {
        body.innerHTML = `<textarea id="ws-edit-area" rows="${Math.max(8, lines.length + 2)}">${esc(p.text)}</textarea>
          <p class="hint">Changes save as you type. Tap “Done editing” to see this step’s highlights again.</p>`;
        const ta = $("#ws-edit-area");
        ta.focus();
        ta.addEventListener("input", () => wsUpdate(id, (x) => { x.text = ta.value; }));
        return;
      }
      body.innerHTML = `<div class="ws-lines ${["listen", "heart"].includes(s.tool) ? "tappable" : ""}">${lines.map((l, i) => {
        const hidden = (wsHide === "first" && i === lines.findIndex((x) => x.trim())) ||
                       (wsHide === "last" && i === lines.length - 1 - [...lines].reverse().findIndex((x) => x.trim()));
        const cls = [p.flags.includes(i) && s.tool === "listen" ? "flagged" : "", p.heart === i ? "heart" : "", hidden ? "hidden-line" : ""].join(" ");
        return l.trim() ? `<div class="ws-line ${cls}" data-line="${i}">${markLine(l, i)}</div>` : `<div class="ws-gap"></div>`;
      }).join("")}</div>`;
      body.querySelectorAll(".tappable .ws-line").forEach((el) => el.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        const i = +el.dataset.line;
        wsUpdate(id, (x) => {
          if (s.tool === "listen") x.flags = x.flags.includes(i) ? x.flags.filter((f) => f !== i) : [...x.flags, i];
          else x.heart = x.heart === i ? null : i;
        });
        renderWorkshop(id);
      }));
    };
    drawPoem();

    // Step tools.
    const speak = (text) => {
      if (!("speechSynthesis" in window)) return alert("Your browser can't read aloud. Read it out loud yourself: it works even better.");
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/\n\s*\n/g, ". \n"));
      u.rate = 0.85;
      speechSynthesis.speak(u);
    };
    if (s.tool === "listen" || s.tool === "finish") {
      tool.innerHTML = `<button type="button" class="ghost small" id="ws-play">▶ Read it to me</button>
        <button type="button" class="quiet" id="ws-stop">■ Stop</button>
        ${s.tool === "listen" ? `<span class="muted">${p.flags.length ? `${p.flags.length} line(s) marked` : "Tap lines in your draft below to mark them."}</span>` : ""}`;
      $("#ws-play").addEventListener("click", () => speak(p.text));
      $("#ws-stop").addEventListener("click", () => speechSynthesis.cancel());
    }
    if (s.tool === "feeling") {
      tool.innerHTML = `<div class="feel-form">
          <label>The feeling, in one word<input id="f-word" value="${esc(p.feeling || "")}" placeholder="longing, relief, shame, tenderness…"></label>
          <label>Where do you feel it in your body?<input id="f-body" value="${esc(p.feelBody || "")}" placeholder="throat, chest, hands…"></label>
          <label>If it were an object, what would it be?<input id="f-image" value="${esc(p.feelImage || "")}" placeholder="a cold cup of tea, a key that doesn’t fit…"></label>
        </div>`;
      const bind = (sel, key) => $(sel).addEventListener("input", (e) => wsUpdate(id, (x) => { x[key] = e.target.value.trim(); }));
      bind("#f-word", "feeling"); bind("#f-body", "feelBody"); bind("#f-image", "feelImage");
      $("#f-word").focus();
    }
    if (s.tool === "rewrite") {
      tool.innerHTML = `
        <textarea id="rw-area" class="blank-page" rows="14" placeholder="${p.feeling ? `It felt like ${esc(p.feeling)}…` : "It felt like…"}">${esc(p.rewrite || "")}</textarea>
        <p class="muted" id="rw-count">${wordCount(p.rewrite || "")} words · saves as you type. “Done” makes this your new draft (the old one stays in your history).</p>
        <details class="peek"><summary>Really stuck? Peek at the old draft</summary><pre>${esc(p.text)}</pre></details>`;
      const ta = $("#rw-area");
      ta.focus();
      ta.addEventListener("input", () => {
        wsUpdate(id, (x) => { x.rewrite = ta.value; });
        $("#rw-count").firstChild.textContent = `${wordCount(ta.value)} words · saves as you type. “Done” makes this your new draft (the old one stays in your history).`;
      });
    }
    if (s.tool === "lens") {
      const LENSES = [
        ["she", "Write yourself as “she” or “he”, from a little distance"],
        ["you", "Speak to someone directly, as “you”"],
        ["object", "Let an object in the scene tell it"],
        ["later", "Tell it from ten years from now"],
      ];
      tool.innerHTML = `
        <div class="chips lens">${LENSES.map(([k, label]) => `<button type="button" data-lens="${k}" class="${p.lensKind === k ? "on" : ""}">${esc(label)}</button>`).join("")}</div>
        <textarea id="lens-area" class="blank-page" rows="8" placeholder="Try a few lines through the lens…">${esc(p.lens || "")}</textarea>
        <div class="row"><button type="button" class="ghost small" id="lens-use">Replace my draft with this</button>
          <span class="muted">or copy the lines you like into your draft below with ✎ Edit.</span></div>`;
      tool.querySelectorAll("[data-lens]").forEach((b) => b.addEventListener("click", () => {
        wsUpdate(id, (x) => { x.lensKind = b.dataset.lens; });
        tool.querySelectorAll("[data-lens]").forEach((o) => o.classList.toggle("on", o === b));
        $("#lens-area").focus();
      }));
      $("#lens-area").addEventListener("input", (e) => wsUpdate(id, (x) => { x.lens = e.target.value; }));
      $("#lens-use").addEventListener("click", () => {
        const text = $("#lens-area").value.replace(/\s+$/, "");
        if (!text.trim()) return;
        wsUpdate(id, (x) => { x.versions.push({ at: Date.now(), text: x.text, label: "Before “Turn the lens”" }); x.text = text; });
        toast("Your draft is now the new version.");
        renderWorkshop(id);
      });
    }
    if (s.tool === "heart") {
      tool.innerHTML = p.heart != null
        ? `<p class="heart-line">♥ ${esc(lines[p.heart] || "")}</p><p class="muted">Every other line should earn its place next to this one.</p>`
        : `<p class="muted">Tap a line in your draft below.</p>`;
    }
    if (s.tool === "cut") {
      if (!p.cutBase) p = wsUpdate(id, (x) => { x.cutBase = wordCount(x.text); });
      const base = p.cutBase;
      const target = Math.round(base * 0.8);
      tool.innerHTML = `<div class="meter-bar"><div style="width:${Math.min(100, Math.round((words / base) * 100))}%"></div></div>
        <p class="muted">${words} words now · target ≈ ${target} ${words <= target ? "· ✓ you did it" : `· ${words - target} to go`}</p>`;
    }
    if (s.tool === "abstract" || s.tool === "verbs" || s.tool === "cliche") {
      const count = body.querySelectorAll(".hl").length;
      tool.innerHTML = `<p class="muted">${count ? `${count} highlighted. You don’t have to change them all: two or three is plenty.` : "Nothing highlighted. Nice. Read it once with this step in mind anyway."}</p>`;
    }
    if (s.tool === "lines") {
      tool.innerHTML = `<p class="muted">Numbers on the right are rough syllable counts. Underlined end words link to their rhymes and synonyms.</p>`;
    }
    if (s.tool === "edges") {
      tool.innerHTML = `<div class="seg">
          <button type="button" data-hide="" class="${!wsHide ? "on" : ""}">Whole poem</button>
          <button type="button" data-hide="first" class="${wsHide === "first" ? "on" : ""}">Without first line</button>
          <button type="button" data-hide="last" class="${wsHide === "last" ? "on" : ""}">Without last line</button>
        </div>`;
      tool.querySelectorAll("[data-hide]").forEach((b) => b.addEventListener("click", () => { wsHide = b.dataset.hide || null; renderWorkshop(id); }));
    }
    if (s.tool === "title") {
      tool.innerHTML = `<input id="ws-title-edit" value="${esc(p.title || "")}" placeholder="A title…">`;
      $("#ws-title-edit").addEventListener("input", (e) => wsUpdate(id, (x) => { x.title = e.target.value; }));
      $("#ws-title-edit").addEventListener("change", () => renderWorkshop(id));
    }
    if (s.tool === "finish") {
      tool.innerHTML += `
        <details class="compare"><summary>Compare first draft and now</summary>
          <div class="compare-cols">
            <div><h3>First draft · ${originalWords} words</h3><pre>${esc(p.original)}</pre></div>
            <div><h3>Now · ${words} words</h3><pre>${esc(p.text)}</pre></div>
          </div>
        </details>
        <div class="next-ideas">
          <h3>What now?</h3>
          <ul>
            <li><strong>Read it to one person.</strong> Watch where they react. That's your poem's real heart.</li>
            <li><strong>Record yourself reading it.</strong> Listening back a week later is a whole new edit.</li>
            <li><strong>Keep it in Inspiration</strong> next to the writers you love: <button type="button" class="ghost small" id="ws-to-inspo">Add to Inspiration</button></li>
            <li><strong>Share it.</strong> Open mics, a writing group, or literary magazines. Duotrope and Submittable list magazines that take new writers.</li>
            <li><strong>Let it rest, then run the workshop again.</strong> Good poems usually take a few rounds.</li>
          </ul>
        </div>`;
      $("#ws-play").addEventListener("click", () => speak(p.text));
      $("#ws-stop").addEventListener("click", () => speechSynthesis.cancel());
      $("#ws-to-inspo").addEventListener("click", () => {
        const d = loadInspo();
        d.added.unshift({ id: "mine-" + Date.now().toString(36), author: "Me", work: p.title || "Untitled", text: p.text });
        store.set("inspo", d);
        toast(`Added to <a href="#inspiration">Inspiration</a>`);
      });
    }

    // Navigation.
    const go = (step, snapshot) => {
      wsEditing = false; wsHide = null;
      if (wsTimer) { clearInterval(wsTimer); wsTimer = null; }
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      wsUpdate(id, (x) => {
        if (snapshot && x.versions[x.versions.length - 1].text !== x.text) {
          x.versions.push({ at: Date.now(), text: x.text, label: `After “${STEPS[n].title}”` });
        }
        x.step = step;
      });
      renderWorkshop(id);
      window.scrollTo(0, 0);
    };
    $("#ws-next").addEventListener("click", () => {
      if (s.tool === "rewrite" && (p = wsGet(id)).rewrite && p.rewrite.trim() && p.rewrite !== p.text) {
        wsUpdate(id, (x) => {
          x.versions.push({ at: Date.now(), text: x.text, label: "Before the rewrite" });
          x.text = x.rewrite.replace(/\s+$/, "");
        });
      }
      go(n + 1, true);
    });
    $("#ws-skip").addEventListener("click", () => go(Math.min(n + 1, STEPS.length), false));
    $("#ws-prev").addEventListener("click", () => go(Math.max(0, n - 1), false));
    app.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => go(+b.dataset.goto, false)));
    $("#ws-edit").addEventListener("click", () => { wsEditing = !wsEditing; renderWorkshop(id); });
    $("#ws-timer").addEventListener("click", (e) => {
      if (wsTimer) { clearInterval(wsTimer); wsTimer = null; e.target.textContent = "⏱ 5-minute timer"; return; }
      let left = 300;
      const tick = () => {
        const b = $("#ws-timer");
        if (!b) { clearInterval(wsTimer); wsTimer = null; return; }
        b.textContent = left > 0 ? `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} (tap to stop)` : "⏱ Time! Stop or keep going";
        if (left-- <= 0) { clearInterval(wsTimer); wsTimer = null; }
      };
      tick();
      wsTimer = setInterval(tick, 1000);
    });
  }

  // ---------- routing ----------
  $("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    const w = $("#q").value.trim();
    if (w) location.hash = "#/" + encodeURIComponent(w.toLowerCase());
  });
  $("#surprise").addEventListener("click", () => {
    const list = window.QUILL_WORDS;
    location.hash = "#/" + encodeURIComponent(list[Math.floor(Math.random() * list.length)]);
  });

  function route() {
    window.scrollTo(0, 0);
    inspoState.composing = null;
    $("#inspo-btn").classList.toggle("on", location.hash === "#inspiration");
    $("#ws-btn").classList.toggle("on", location.hash.startsWith("#workshop"));
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (location.hash === "#inspiration") return renderInspiration();
    if (location.hash === "#workshop") return renderWorkshopHome();
    if (location.hash.startsWith("#workshop/")) return renderWorkshop(decodeURIComponent(location.hash.slice(10)));
    if (location.hash.startsWith("#poem/")) {
      const [author, title, word] = location.hash.slice(6).split("/").map(decodeURIComponent);
      return renderPoem(author, title, word);
    }
    const w = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    if (w) renderWord(w); else { $("#q").value = ""; renderHome(); }
  }
  window.addEventListener("hashchange", route);
  updateJournalCount();
  route();
})();
