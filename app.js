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

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-save-poem]");
    if (!b) return;
    toggleSavePoem(b.dataset.savePoem);
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
    fill("lit", `<div id="lit-library"><p class="loading">Searching the library…</p></div>
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

    const openArchive = () => { $("#lit-library").innerHTML = ""; $("#lit-archive").open = true; };
    local.then((loc) => library(word, loc && loc.formOf)).then(guard(({ items, forms }) => {
      const shown = group("lit-library", "From writers you love", items.map(([b, text, kind]) => figure(
        kind === "v" ? text.split("\n").map((l) => `<span>${highlightForms(l, forms)}</span>`).join("") : highlightForms(text, forms),
        `${esc(b.author)}, <cite>${esc(b.title)}</cite> (${b.year}) ·
         <a href="https://www.gutenberg.org/ebooks/${b.id}" target="_blank" rel="noopener">Read the book →</a>`)));
      if (!shown) openArchive();
    })).catch(guard(openArchive));

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
    const all = [...data.added.map((p) => ({ ...p, mine: true })), ...savedPoemPassages(), ...window.QUILL_PASSAGES];
    const authors = [...new Set(all.map((p) => p.author))].sort((a, b) =>
      a.split(" ").pop().localeCompare(b.split(" ").pop()));
    const f = inspoState.filter;
    const shown = all.filter((p) =>
      (!inspoState.author || p.author === inspoState.author) &&
      (f === "all" ||
       (f === "liked" && data.liked[p.id]) ||
       (f === "mine" && p.mine) ||
       (f === "poems" && p.poem) ||
       (f === "writing" && (data.notes[p.id] || []).length)));

    const filters = [["all", "All"], ["liked", "♥ Loved"], ["writing", "✎ With my writing"], ["poems", "📜 Saved poems"], ["mine", "Added by me"]];
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
                f === "poems" ? "No saved poems yet. Look up a word, then tap “☆ Save poem” under any poem in the In literature section." :
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
  function savedPoemPassages() {
    return Object.entries(store.get("poems", {}))
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .map(([id, poem]) => {
        const lines = poem.lines.filter((l) => l.trim());
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
      savedPoemPassages().find((x) => x.id === id) || window.QUILL_PASSAGES.find((x) => x.id === id);
    card.outerHTML = passageCard(passage, data);
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
    if (location.hash === "#inspiration") return renderInspiration();
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
