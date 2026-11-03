/* Word World: sync across devices through a private GitHub gist.
 *
 * What syncs: the journal, Inspiration (loved passages, notes, your writing, passages you added),
 * saved poems and passages, Workshop drafts, your favourite writers and recent words.
 * What doesn't: the etymology cache (it refills by itself).
 *
 * How: a GitHub key (token) with only the "gist" permission is pasted once per device. It stays
 * in this browser. The app keeps one secret gist named "Word World sync (private)".
 *
 * Merging: every saved thing (a journal word, a loved passage, a note, a saved poem, a draft…)
 * is merged one by one, so two devices never overwrite each other. Each add or delete is
 * remembered with its time, so the latest one wins and deleted things stay deleted.
 * Loaded before app.js so it notices every save. */
(function () {
  "use strict";

  const PREFIX = "quill:";
  const META_KEY = "wordworld-sync";
  const DESC = "Word World sync (private)";
  const FILE = "word-world-data.json";
  const API = "https://api.github.com";

  // How each saved store breaks into items: elems() maps item keys to items; build() puts them back.
  const byId = (name) => ({
    elems: (v) => Object.fromEntries(Object.entries(v || {}).map(([id, x]) => [`${name}:${id}`, x])),
    build: (m) => Object.fromEntries(Object.entries(m).map(([k, x]) => [k.slice(name.length + 1), x])),
  });
  const STORES = {
    journal: {
      elems: (v) => Object.fromEntries(Object.entries(v || {}).map(([w, x]) => [`journal:${w}`, x])),
      build: (m) => Object.fromEntries(Object.entries(m).map(([k, x]) => [k.slice(8), x])),
      combine: (a, b) => ({ ...a, added: Math.min(a.added || Infinity, b.added || Infinity),
        lines: [...new Set([...(a.lines || []), ...(b.lines || [])])] }),
    },
    poems: byId("poems"),
    quotes: byId("quotes"),
    workshop: {
      elems: (v) => Object.fromEntries((v || []).map((d) => [`draft:${d.id}`, d])),
      build: (m) => Object.values(m),
      combine: (a, b) => ((b.updatedAt || 0) > (a.updatedAt || 0) ? b : a),
    },
    inspo: {
      elems: (v) => {
        const out = {};
        Object.keys((v && v.liked) || {}).forEach((id) => { out[`liked:${id}`] = true; });
        ((v && v.added) || []).forEach((p, i) => { out[`added:${p.id}`] = { ...p, _i: i }; });
        Object.entries((v && v.notes) || {}).forEach(([pid, list]) =>
          (list || []).forEach((n) => { out[`note:${pid}|${n.id}`] = n; }));
        return out;
      },
      build: (m) => {
        const v = { liked: {}, added: [], notes: {} };
        Object.entries(m).forEach(([k, x]) => {
          if (k.startsWith("liked:")) v.liked[k.slice(6)] = true;
          else if (k.startsWith("added:")) v.added.push(x);
          else if (k.startsWith("note:")) {
            const [pid] = k.slice(5).split("|");
            (v.notes[pid] ||= []).push(x);
          }
        });
        v.added.sort((a, b) => (a._i ?? 0) - (b._i ?? 0)).forEach((p) => delete p._i);
        Object.values(v.notes).forEach((l) => l.sort((a, b) => (a.at || 0) - (b.at || 0)));
        return v;
      },
    },
    writers: "whole",
    recent: "whole",
  };
  const KEYS = Object.keys(STORES).map((k) => PREFIX + k);

  const rawGet = Storage.prototype.getItem;
  const rawSet = Storage.prototype.setItem;
  let applying = false, pushTimer = null, busy = false;

  function readMeta() {
    try { return JSON.parse(rawGet.call(localStorage, META_KEY)) || {}; } catch (e) { return {}; }
  }
  let meta = readMeta();
  meta.changes ||= {};
  function writeMeta() { try { rawSet.call(localStorage, META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ } }

  const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

  // Remember what changed in each save: items added, edited or removed, with the time.
  function recordChanges(name, oldV, newV, t) {
    const spec = STORES[name];
    if (spec === "whole") { meta.changes[name] = { t, alive: true }; return; }
    const a = spec.elems(oldV), b = spec.elems(newV);
    Object.keys(a).forEach((k) => { if (!(k in b)) meta.changes[`${name}/${k}`] = { t, alive: false }; });
    Object.keys(b).forEach((k) => {
      if (!(k in a) || JSON.stringify(a[k]) !== JSON.stringify(b[k])) meta.changes[`${name}/${k}`] = { t, alive: true };
    });
  }

  Storage.prototype.setItem = function (k, v) {
    let oldRaw = null;
    const watched = this === localStorage && KEYS.includes(k) && !applying;
    if (watched) { try { oldRaw = rawGet.call(this, k); } catch (e) { /* ignore */ } }
    rawSet.call(this, k, v);
    if (watched && oldRaw !== String(v)) {
      const t = Date.now();
      recordChanges(k.slice(PREFIX.length), parse(oldRaw), parse(String(v)), t);
      meta.dirty = true;
      meta.localUpdated = t;
      writeMeta();
      schedulePush();
    }
  };

  function connected() { return !!(meta.token && meta.gistId); }

  function api(path, opts) {
    return fetch(API + path, Object.assign({}, opts, {
      headers: { Authorization: "Bearer " + meta.token, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    })).then((r) => {
      if (r.status === 401) throw new Error("The key was refused. Make a new one with the “gist” permission.");
      if (r.status === 404) throw new Error("not-found");
      if (!r.ok) throw new Error("GitHub said " + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  function bundle() {
    const stores = {};
    KEYS.forEach((k) => { stores[k.slice(PREFIX.length)] = parse(rawGet.call(localStorage, k)); });
    return { app: "word-world", v: 1, updated: meta.localUpdated || Date.now(), stores, changes: meta.changes };
  }

  // Combine two copies item by item. For each item, the latest recorded add/delete wins.
  function merge(newer, older) {
    const changes = { ...(older.changes || {}) };
    Object.entries(newer.changes || {}).forEach(([k, c]) => { if (!changes[k] || c.t >= changes[k].t) changes[k] = c; });
    const stores = {};
    Object.entries(STORES).forEach(([name, spec]) => {
      const a = (newer.stores || {})[name], b = (older.stores || {})[name];
      if (spec === "whole") {
        const ta = ((newer.changes || {})[name] || {}).t || 0, tb = ((older.changes || {})[name] || {}).t || 0;
        stores[name] = a == null ? b : b == null ? a : (tb > ta ? b : a);
        return;
      }
      if (a == null && b == null) { stores[name] = null; return; }
      const ea = spec.elems(a), eb = spec.elems(b), out = {};
      new Set([...Object.keys(ea), ...Object.keys(eb)]).forEach((k) => {
        const c = changes[`${name}/${k}`];
        if (c && !c.alive) return; // deleted last
        if (k in ea && k in eb) {
          if (spec.combine) out[k] = spec.combine(ea[k], eb[k]);
          else {
            const ca = ((newer.changes || {})[`${name}/${k}`] || {}).t || 0, cb = ((older.changes || {})[`${name}/${k}`] || {}).t || 0;
            out[k] = cb > ca ? eb[k] : ea[k];
          }
        } else if (k in ea) {
          out[k] = ea[k];
        } else if (!c || c.alive) {
          out[k] = eb[k];
        }
      });
      stores[name] = spec.build(out);
    });
    // Forget delete records after 180 days so the list doesn't grow forever.
    const cutoff = Date.now() - 180 * 86400000;
    Object.keys(changes).forEach((k) => { if (!changes[k].alive && changes[k].t < cutoff) delete changes[k]; });
    return { app: "word-world", v: 1, updated: Math.max(newer.updated || 0, older.updated || 0), stores, changes };
  }
  const same = (x, y) => JSON.stringify(x.stores) === JSON.stringify(y.stores);

  function applyRemote(remote) {
    applying = true;
    Object.entries(remote.stores || {}).forEach(([name, v]) => {
      if (v != null) rawSet.call(localStorage, PREFIX + name, JSON.stringify(v));
    });
    applying = false;
    meta.changes = remote.changes || {};
    meta.lastSynced = remote.updated;
    meta.localUpdated = remote.updated;
    meta.dirty = false;
    writeMeta();
  }

  function readGist() {
    return api("/gists/" + meta.gistId).then((g) => {
      const f = g.files && g.files[FILE];
      if (!f) return null;
      if (!f.truncated) return JSON.parse(f.content || "null");
      return fetch(f.raw_url).then((r) => r.json());
    });
  }

  function writeGist(data) {
    return api("/gists/" + meta.gistId, {
      method: "PATCH",
      body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(data) } } }),
    });
  }

  function setStatus(text) {
    meta.status = text;
    meta.statusAt = Date.now();
    writeMeta();
    document.querySelectorAll(".sync-status").forEach((el) => { el.textContent = text; });
  }

  // Pull, combine, push. Reload when another device brought something new.
  function sync(reason) {
    if (!connected() || busy || !navigator.onLine) return Promise.resolve();
    busy = true;
    return readGist().then((remote) => {
      const local = bundle();
      if (!remote || !remote.stores) {
        return writeGist(local).then(() => { meta.dirty = false; meta.lastSynced = local.updated; writeMeta(); setStatus("Synced just now"); });
      }
      const localFirst = meta.dirty && (local.updated || 0) >= (remote.updated || 0);
      const merged = localFirst ? merge(local, remote) : merge(remote, local);
      if (!localFirst) merged.updated = Math.max(remote.updated || 0, Date.now() - 1);
      const needWrite = !same(merged, remote) || JSON.stringify(merged.changes) !== JSON.stringify(remote.changes || {});
      const needApply = !same(merged, local);
      const asked = reason === "connect" || reason === "manual";
      return (needWrite ? writeGist(merged) : Promise.resolve()).then(() => {
        if (needApply) {
          if (!asked && userBusy()) {
            meta.lastSynced = 0;
            writeMeta();
            setStatus("New changes from another device. They'll load when you're done typing.");
            return;
          }
          applyRemote(merged);
          setStatus(needWrite ? "Synced just now, combined with another device" : "Synced just now");
          location.reload();
          return;
        }
        meta.changes = merged.changes;
        meta.dirty = false;
        meta.lastSynced = merged.updated;
        meta.localUpdated = merged.updated;
        writeMeta();
        setStatus(needWrite ? "Synced just now" : "Up to date");
      });
    }).catch((e) => {
      if (e.message === "not-found") { meta.gistId = ""; writeMeta(); setStatus("The sync gist was deleted. Connect again."); return; }
      setStatus("Couldn't sync: " + e.message);
    }).finally(() => { busy = false; });
  }

  // Never reload under someone's fingers: typing, or the sync window open.
  function userBusy() {
    const ae = document.activeElement;
    return !!document.querySelector("dialog[open]") ||
      !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.id !== "sync-token");
  }

  function schedulePush() {
    if (!connected()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => sync("change"), 4000);
  }

  function connect(token) {
    meta.token = token.trim();
    writeMeta();
    setStatus("Connecting…");
    return api("/gists?per_page=100").then((list) => {
      const found = (list || []).find((g) => g.description === DESC && g.files && g.files[FILE]);
      if (found) {
        meta.gistId = found.id;
        meta.lastSynced = 0;
        meta.dirty = true; // combine this device's things with what's there
        writeMeta();
        return sync("connect");
      }
      const data = bundle();
      return api("/gists", {
        method: "POST",
        body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(data) } } }),
      }).then((g) => {
        meta.gistId = g.id;
        meta.dirty = false;
        meta.lastSynced = data.updated;
        writeMeta();
        setStatus("Connected. This is the first device, and everything is saved.");
      });
    }).catch((e) => { meta.token = ""; meta.gistId = ""; writeMeta(); setStatus("Couldn't connect: " + e.message); throw e; });
  }

  function disconnect() {
    meta = { changes: meta.changes || {} };
    writeMeta();
    setStatus("Not syncing on this device");
  }

  /* ---------- the sync window ---------- */
  function ago(t) {
    if (!t) return "";
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return new Date(t).toLocaleDateString();
  }

  function renderDialog() {
    const box = document.getElementById("sync-body");
    if (!box) return;
    if (connected()) {
      box.innerHTML =
        '<p class="sync-ok">✓ This device is syncing.</p>' +
        '<p class="muted sync-status">' + (meta.status || "") + "</p>" +
        (meta.lastSynced ? '<p class="muted">Last synced ' + ago(meta.lastSynced) + "</p>" : "") +
        "<p>Your journal, Inspiration (loved passages, notes and your writing), saved poems and passages, " +
        "Workshop drafts and favourite writers are kept in a private gist in your GitHub account and appear on every device you connect.</p>" +
        '<div class="sync-btns"><button type="button" class="quiet" id="sync-off">Stop syncing on this device</button>' +
        '<button type="button" class="primary" id="sync-now">Sync now</button></div>';
    } else {
      box.innerHTML =
        "<p>Keep Word World the same on your phone, laptop and any other device. Everything goes into a <b>private</b> gist " +
        "(a small file) in your own GitHub account. Only you can see it.</p>" +
        '<p><a class="primary big-link" href="https://github.com/settings/tokens/new?scopes=gist&amp;description=Word%20World%20sync" ' +
        'target="_blank" rel="noopener">1. Get my key on GitHub ↗</a></p>' +
        '<ol class="sync-steps">' +
        "<li>Sign in to GitHub if it asks.</li>" +
        "<li>Under <b>Expiration</b>, pick “No expiration” (or a date far away).</li>" +
        "<li>Leave only <b>gist</b> ticked. It already is.</li>" +
        "<li>Scroll down, press <b>Generate token</b>, and copy the key that starts with <code>ghp_</code>. GitHub shows it only once.</li>" +
        "<li>Come back here, paste it below, and press Connect.</li>" +
        "<li>On each other device, open Word World, tap Sync and paste the same key.</li></ol>" +
        '<p class="muted">Already made a key for My Hangout or Calm Player? It works here too: paste the same one.</p>' +
        '<label class="sync-field">2. Paste your key<input type="password" id="sync-token" placeholder="ghp_…" autocomplete="off"></label>' +
        '<p class="muted sync-status">' + (meta.status || "") + "</p>" +
        '<button type="button" class="primary" id="sync-connect">Connect this device</button>' +
        '<p class="muted small">The key stays in this browser and can only read and write gists, not your code or anything else.</p>';
    }
  }

  document.addEventListener("click", function (e) {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.matches("[data-sync-open]")) {
      const j = document.getElementById("journal");
      if (j) j.hidden = true;
      renderDialog();
      document.getElementById("sync-dialog").showModal();
    }
    if (t.id === "sync-close") { document.getElementById("sync-dialog").close(); setTimeout(() => sync("focus"), 50); }
    if (t.id === "sync-connect") {
      const v = document.getElementById("sync-token").value;
      if (!v.trim()) return;
      t.disabled = true;
      t.textContent = "Connecting…";
      connect(v).then(renderDialog, renderDialog);
    }
    if (t.id === "sync-now") { meta.dirty = true; writeMeta(); sync("manual").then(renderDialog); }
    if (t.id === "sync-off") {
      if (confirm("Stop syncing on this device? Your things stay here and in the gist.")) { disconnect(); renderDialog(); }
    }
  });

  /* ---------- when to sync ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".sync-status").forEach((el) => {
      el.textContent = connected() ? (meta.status || "Syncing") : "Not syncing yet";
    });
    sync("open");
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") sync("focus");
    else if (meta.dirty) sync("leave");
  });
  window.addEventListener("online", function () { sync("online"); });
  setInterval(function () { if (document.visibilityState === "visible") sync("timer"); }, 2 * 60 * 1000);

  window.WordWorldSync = { sync, connected, _merge: merge };
})();
