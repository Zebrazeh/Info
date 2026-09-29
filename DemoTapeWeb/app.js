/* DemoTape – Browser-Version. Gleiches Playlist- und .tape-Format wie die iOS-App. */
"use strict";

// ---------------------------------------------------------------- Texte (de/en)
const LANG = (navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en";
const T = {
  de: {
    insert: "Tape einlegen", insertBtn: "Einlegen", address: "Playlist-Adresse", recent: "Zuletzt eingelegt",
    badAddress: "Bitte eine https-Adresse einer M3U-Playlist angeben.", privacy: "Datenschutzerklärung",
    share: "Tape teilen", scanHint: "Mit der Handykamera scannen – das Tape wird direkt eingelegt.",
    copy: "Link kopieren", copied: "Kopiert ✓", shareLink: "Link teilen", close: "Schließen",
    prev: "Zurück", next: "Vor", play: "Abspielen", pause: "Pause", stop: "Stopp", eject: "Auswerfen",
    legend: "◀◀ / ▶▶ kurz tippen = Titel wechseln · gedrückt halten = spulen",
    loading: "Tape wird eingelegt …", other: "Anderes Tape einlegen", remove: "Entfernen",
    errEmpty: "In der Playlist stehen keine abspielbaren https-Titel.",
    errNotList: "Unter dieser Adresse liegt keine M3U-Playlist.",
    errLoad: "Die Playlist konnte nicht geladen werden.",
    errTrack: "Der Titel konnte nicht geladen werden.",
    loadingShort: "LADE",
  },
  en: {
    insert: "Insert tape", insertBtn: "Insert", address: "Playlist address", recent: "Recently played",
    badAddress: "Please enter the https address of an M3U playlist.", privacy: "Privacy policy",
    share: "Share tape", scanHint: "Scan with your phone camera – the tape is inserted right away.",
    copy: "Copy link", copied: "Copied ✓", shareLink: "Share link", close: "Close",
    prev: "Previous", next: "Next", play: "Play", pause: "Pause", stop: "Stop", eject: "Eject",
    legend: "◀◀ / ▶▶ tap = change track · hold = wind the tape",
    loading: "Inserting tape …", other: "Insert another tape", remove: "Remove",
    errEmpty: "The playlist contains no playable https tracks.",
    errNotList: "There is no M3U playlist at this address.",
    errLoad: "The playlist could not be loaded.",
    errTrack: "The track could not be loaded.",
    loadingShort: "LOADING",
  },
}[LANG];
document.documentElement.lang = LANG;
document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = T[el.dataset.i18n]; });
document.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", T[el.dataset.i18nAria]));

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- Playlist (M3U)
function fallbackTitle(url) {
  let name = decodeURIComponent(url.split("?")[0].split("/").pop() || "");
  if (/\.tape$/i.test(name)) name = name.slice(0, -5);
  name = name.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const stripped = name.replace(/^\d+\s*[-.]?\s*/, "");
  return (stripped || name).trim();
}

function parseExtInf(value) {
  let inQuotes = false, split = -1;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') inQuotes = !inQuotes;
    if (value[i] === "," && !inQuotes) { split = i; break; }
  }
  const head = split >= 0 ? value.slice(0, split) : value;
  const name = split >= 0 ? value.slice(split + 1).trim() : "";
  const d = parseFloat(head.split(" ")[0]);
  const duration = d > 0 ? d : null;
  if (!name) return { duration };
  const m = name.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { duration, artist: m[1].trim(), title: m[2].trim() } : { duration, title: name };
}

function parseM3U(text, base) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines[0] && /^<(!doctype|html)/i.test(lines[0])) throw new Error("notList");
  let tape = null, band = null, info = null, image = null;
  const layout = {};
  const tracks = [];
  for (const line of lines) {
    if (line.startsWith("#")) {
      const up = line.toUpperCase();
      const val = () => line.slice(line.indexOf(":") + 1).trim();
      if (up.startsWith("#PLAYLIST:") || up.startsWith("#EXTALB:")) tape = tape || val() || null;
      else if (up.startsWith("#EXTART:")) band = val() || band;
      else if (up.startsWith("#EXTIMG:")) { try { image = new URL(val(), base).href; } catch {} }
      else if (up.startsWith("#DEMOTAPE-REELS:")) { const n = val().split(",").map(Number); if (n.length === 5 && n.every(isFinite)) layout.reels = n; }
      else if (up.startsWith("#DEMOTAPE-TITLE:")) { const v = val(); const n = v.split(",").map(Number);
        if (v.toLowerCase() === "off") layout.title = "off"; else if (n.length === 3 && n.every(isFinite)) layout.title = n; }
      else if (up.startsWith("#EXTINF:")) info = parseExtInf(val());
      continue;
    }
    let url;
    try { url = new URL(line, base); } catch { info = null; continue; }
    if (url.protocol !== "https:" && location.protocol === "https:") { info = null; continue; }
    tracks.push({ id: tracks.length, url: url.href, title: (info && info.title) || fallbackTitle(url.href),
                  artist: info && info.artist, duration: info && info.duration });
    info = null;
  }
  if (!tracks.length) throw new Error("empty");
  band = band || (tracks.find(t => t.artist) || {}).artist || fallbackTitle(base);
  return { source: base, band, tape, tracks, image, layout };
}

// ---------------------------------------------------------------- .tape-Entschluesselung
// Format wie TapeCipher.swift: "DTAPE1" + 12 Byte Nonce + Chiffrat + 16 Byte GCM-Tag.
let cryptoKey = null;
async function decryptTape(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = "DTAPE1";
  for (let i = 0; i < 6; i++) if (bytes[i] !== magic.charCodeAt(i)) throw new Error("notTape");
  if (!cryptoKey) {
    const raw = new Uint8Array(window.DT_K[0].map((b, i) => b ^ window.DT_K[1][i]));
    cryptoKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  }
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(6, 18) }, cryptoKey, bytes.subarray(18));
}

const MIME = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg" };
const isTape = url => /\.tape(\?|$)/i.test(url);

// ---------------------------------------------------------------- Verlauf
const store = {
  get() { try { return JSON.parse(localStorage.getItem("recentTapes") || "[]"); } catch { return []; } },
  set(list) { try { localStorage.setItem("recentTapes", JSON.stringify(list)); } catch {} },
  remember(pl) {
    const list = this.get().filter(e => e.url !== pl.source);
    list.unshift({ url: pl.source, band: pl.band, tape: pl.tape });
    this.set(list.slice(0, 12));
  },
  remove(url) { this.set(this.get().filter(e => e.url !== url)); },
};

// ---------------------------------------------------------------- Spulgeraeusch (Web Audio)
const fx = {
  ctx: null, buffers: {}, loop: null, gain: null, ready: null, wantDir: 0,
  // Kontext + Klaenge sofort beim Seitenaufruf vorbereiten (Dekodieren geht auch im
  // angehaltenen Zustand) – sonst sind die Klaenge beim ersten Spulen noch nicht da.
  raw: {},
  // Beim Seitenaufruf nur die Klang-Dateien laden. Den Audio-Kontext erst in der ersten Geste
  // anlegen: Ein schon existierender Kontext, der gleichzeitig mit der Musik anlaeuft, stellt
  // auf dem iPhone die Audio-Sitzung um – die Musik laeuft dann stumm weiter.
  preload() {
    this.fetched = Promise.all(["wind_loop", "key_down", "key_up"].map(async n => {
      try { this.raw[n] = await (await fetch(`sounds/${n}.wav`)).arrayBuffer(); } catch {}
    }));
  },
  init() {
    if (this.ctx) return this.ready;
    // iOS: Web Audio sonst stumm bei Stummschalter.
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.ready = Promise.resolve(); return this.ready; }
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.5;
    this.gain.connect(this.ctx.destination);
    // Laeuft der Kontext erst an, waehrend die Musik schon spielt, kurz neu starten – sonst
    // bleibt sie auf dem iPhone stumm (Umstellung der Audio-Sitzung).
    this.ctx.onstatechange = () => { if (this.ctx.state === "running") kickMusic(); };
    this.ready = (this.fetched || Promise.resolve()).then(() => Promise.all(Object.entries(this.raw).map(async ([n, data]) => {
      try { this.buffers[n] = await new Promise((ok, err) => this.ctx.decodeAudioData(data.slice(0), ok, err)); } catch {}
    })));
    return this.ready;
  },
  // iOS schaltet Web Audio nur in "Loslassen/Tippen"-Ereignissen frei. Deshalb bei jeder
  // solchen Geste fortsetzen und einen stummen Mini-Puffer abspielen.
  unlock() {
    this.init();
    if (!this.ctx || this.ctx.state === "running") return;
    try {
      this.ctx.resume();
      const s = this.ctx.createBufferSource();
      s.buffer = this.ctx.createBuffer(1, 1, 22050);
      s.connect(this.ctx.destination);
      s.start(0);
    } catch {}
  },
  running() { return this.ctx && this.ctx.state === "running"; },
  click(name) {
    const b = this.buffers[name];
    if (!this.running() || !b) return;
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = 1.6;
    s.buffer = b; s.connect(g).connect(this.ctx.destination); s.start();
  },
  begin(dir) {
    this.init();
    this.wantDir = dir;
    if (this.running() && this.buffers.wind_loop) { this.startLoop(dir); return; }
    // Noch nicht bereit: Geraeusch nachholen, sobald Klaenge geladen und Ausgabe frei ist.
    this.ready.then(() => this.ctx && this.ctx.resume()).then(() => {
      if (this.wantDir === dir && !this.loop) this.startLoop(dir);
    }).catch(() => {});
  },
  startLoop(dir) {
    this.stopLoop(0);
    const b = this.buffers.wind_loop;
    if (!b || !this.running()) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.loop = true; s.connect(this.gain);
    const now = this.ctx.currentTime;
    // Motor laeuft an: Tempo und Tonhoehe ziehen gemeinsam hoch.
    s.playbackRate.setValueAtTime(0.45, now);
    s.playbackRate.setTargetAtTime(dir > 0 ? 1.0 : 0.94, now, 0.1);
    s.start();
    this.loop = s;
  },
  end() {
    this.wantDir = 0;
    if (!this.ctx) return;
    this.stopLoop(0.12);
  },
  stopLoop(after) {
    const s = this.loop;
    if (!s) return;
    this.loop = null;
    const now = this.ctx.currentTime;
    s.playbackRate.cancelScheduledValues(now);
    s.playbackRate.setValueAtTime(s.playbackRate.value, now);
    s.playbackRate.linearRampToValueAtTime(0.35, now + after);
    s.stop(now + after + 0.01);
  },
};
fx.preload();
// Nur echte Freischalt-Gesten: Beruehren (touchstart) zaehlt auf dem iPhone nicht.
for (const type of ["touchend", "pointerup", "click", "keydown"]) {
  document.addEventListener(type, () => { fx.unlock(); unlockAudio(); }, { capture: true, passive: true });
}

// ---------------------------------------------------------------- Eigene Tape-Vorlage (Bild)
// Liegt neben der Playlist tape.jpg/.png/.webp (oder nennt die Playlist #EXTIMG:<bild>), wird
// dieses Bild als Kassette gezeigt. Die Spulennaben werden rund aus dem Bild ausgeschnitten und
// gedreht; der aktuelle Titel steht handschriftlich auf der freien Etikettflaeche.
// Geometrie (Anteile von Breite/Hoehe) ist die eines ueblichen Kassettenfotos, per Playlist
// ueberschreibbar:  #DEMOTAPE-REELS:x1,y1,x2,y2,radius   #DEMOTAPE-TITLE:x,y,breite | off
const TAPE_IMAGE_NAMES = ["tape.jpg", "tape.png", "tape.webp"];
const DEFAULT_LAYOUT = { reels: [0.297, 0.457, 0.700, 0.457, 0.052], title: [0.5, 0.632, 0.62] };
const RETRO = !!document.querySelector(".unit");
const SVGNS = "http://www.w3.org/2000/svg";

function loadImage(url, timeout = 4000) {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), timeout);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth ? img : null); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

async function findTapeImage(pl) {
  const candidates = pl.image ? [pl.image] : TAPE_IMAGE_NAMES.map(n => new URL(n, pl.source).href);
  for (const url of candidates) {
    const img = await loadImage(url);
    if (img) return img;
  }
  return null;
}

function svgEl(name, attrs, parent) {
  const el = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function buildImageTape(img, layout) {
  const old = document.getElementById("imageTape");
  if (old) old.remove();
  const W = img.naturalWidth, H = img.naturalHeight;
  const [x1, y1, x2, y2, r] = layout.reels || DEFAULT_LAYOUT.reels;
  const svg = svgEl("svg", { id: "imageTape", class: "cassette image-tape", "aria-hidden": "true",
    viewBox: RETRO ? `0 0 ${H} ${W}` : `0 0 ${W} ${H}` });
  // Im Retro-Geraet steht die Kassette hochkant (Band laeuft nach oben).
  const g = svgEl("g", RETRO ? { transform: `translate(0 ${W}) rotate(-90)` } : {}, svg);
  svgEl("image", { href: img.src, width: W, height: H }, g);
  const defs = svgEl("defs", {}, g);
  const spins = [[x1, y1], [x2, y2]].map(([fx, fy], i) => {
    const cx = fx * W, cy = fy * H, rr = r * W;
    const clip = svgEl("clipPath", { id: `tapeHub${i}` }, defs);
    svgEl("circle", { cx, cy, r: rr }, clip);
    const holder = svgEl("g", { "clip-path": `url(#tapeHub${i})` }, g);
    const el = svgEl("image", { href: img.src, width: W, height: H }, holder);
    return { el, cx, cy };
  });
  let title = null, titleWidth = 0;
  const t = layout.title === "off" ? null : (layout.title || DEFAULT_LAYOUT.title);
  if (t) {
    titleWidth = t[2] * W;
    title = svgEl("text", { x: t[0] * W, y: t[1] * H, "text-anchor": "middle", "dominant-baseline": "middle",
      class: "ink image-title", "font-size": (0.068 * H).toFixed(1), transform: `rotate(-1.2 ${t[0] * W} ${t[1] * H})` }, g);
  }
  $("cassette").parentNode.insertBefore(svg, $("cassette"));
  return { svg, spins, title, titleWidth };
}

// ---------------------------------------------------------------- Player
const audio = new Audio();
audio.preload = "auto";
const SEEK_STEP = 1.5;

// iOS Safari erlaubt play() nur innerhalb einer Beruehrung. Verschluesselte Titel starten aber
// erst nach dem Laden – deshalb wird das Element beim ersten Tippen einmal stumm "entsperrt".
let audioUnlocked = false, unlocking = false;
function unlockAudio() {
  // Ist schon ein echter Titel geladen, entsperrt die Play-Taste das Element selbst.
  if (audioUnlocked || unlocking || state.srcReady) return;
  unlocking = true;
  const header = new Uint8Array([82,73,70,70,40,0,0,0,87,65,86,69,102,109,116,32,16,0,0,0,1,0,1,0,
    68,172,0,0,136,88,1,0,2,0,16,0,100,97,116,97,4,0,0,0,0,0,0,0]);
  audio.src = URL.createObjectURL(new Blob([header], { type: "audio/wav" }));
  // Erst bei Erfolg als entsperrt merken – ein Versuch ausserhalb einer gueltigen Geste
  // (z. B. beim Beruehren statt Loslassen) wird beim naechsten Tippen wiederholt.
  audio.play().then(() => { audioUnlocked = true; if (!state.srcReady) audio.pause(); })
    .catch(() => {}).finally(() => { unlocking = false; });
}

const state = {
  playlist: null, index: 0, playing: false, seekDir: 0, buffering: false,
  playWhenReady: false, resumeAfterSeek: false, token: 0, srcReady: false,
  kicking: false, seekToEnd: false,
  imageTape: null,
  blobs: new Map(), // track-URL -> Object-URL (entschluesselt, nur im Speicher)
};

// Soll das Band laufen? Auch waehrend ein Titel noch laedt (playWhenReady).
function wantPlay() { return state.playing || state.playWhenReady; }

function currentTrack() {
  const pl = state.playlist;
  return pl && pl.tracks[state.index];
}

async function loadPlaylist(url) {
  const token = ++state.token;
  stop();
  state.playing = false;
  state.srcReady = false;
  audio.removeAttribute("src"); audio.load();
  for (const u of state.blobs.values()) URL.revokeObjectURL(u);
  state.blobs.clear();
  pruneDownloads(new Set());
  state.playlist = null;
  showStatus("loading");
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("load");
    const pl = parseM3U(await res.text(), res.url || url);
    if (token !== state.token) return;
    // Eigene Tape-Vorlage? Vor dem Anzeigen suchen, damit nicht erst die Standardkassette aufblitzt.
    const tapeImg = await findTapeImage(pl);
    if (token !== state.token) return;
    const old = document.getElementById("imageTape");
    if (old) old.remove();
    state.imageTape = tapeImg ? buildImageTape(tapeImg, pl.layout) : null;
    state.playlist = pl;
    store.remember(pl);
    history.replaceState(null, "", location.pathname + "?list=" + encodeURIComponent(url));
    showStatus(null);
    select(0, false);
  } catch (e) {
    if (token !== state.token) return;
    const msg = e.message === "empty" ? T.errEmpty : e.message === "notList" ? T.errNotList : T.errLoad;
    showStatus("error", msg);
  }
  render();
}

// Downloads verschluesselter Titel: je Titel hoechstens einer gleichzeitig (Vorabladen und
// Titelwahl teilen ihn), ueberholte werden abgebrochen, Fortschritt fuer die Anzeige, und
// fertige Tapes bleiben (verschluesselt) im Browser-Zwischenspeicher fuer den naechsten Besuch.
const TAPE_CACHE = "demotape-tapes-v2";
// v1 konnte durch einen Fehler unbrauchbare Daten enthalten – einmalig entfernen.
try { caches.delete("demotape-tapes-v1"); } catch {}
const TAPE_CACHE_MAX = 16;
const downloads = new Map(); // url -> { promise, controller, listeners:Set, progress }
const fromCache = new Set();  // Titel, deren Daten aus dem Zwischenspeicher kamen

async function cachedTape(url) {
  try { const c = await caches.open(TAPE_CACHE); const r = await c.match(url); return r ? await r.arrayBuffer() : null; }
  catch { return null; }
}
async function storeTape(url, buffer) {
  try {
    const c = await caches.open(TAPE_CACHE);
    await c.put(url, new Response(buffer, { headers: { "Content-Type": "application/octet-stream" } }));
    const keys = await c.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - TAPE_CACHE_MAX))) await c.delete(k);
  } catch {}
}

function downloadTape(url, onProgress, skipCache = false) {
  let d = downloads.get(url);
  if (!d) {
    const controller = new AbortController();
    d = { controller, listeners: new Set(), progress: 0 };
    const report = p => { d.progress = p; d.listeners.forEach(fn => fn(p)); };
    d.promise = (async () => {
      const hit = skipCache ? null : await cachedTape(url);
      if (hit) { fromCache.add(url); report(1); return hit; }
      fromCache.delete(url);
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error("track");
      // Content-Length ist nur ein Schaetzwert fuer die Anzeige: GitHub Pages liefert
      // komprimiert aus, die entpackte Groesse weicht davon ab. Deshalb genau das uebernehmen,
      // was tatsaechlich ankommt.
      const total = +res.headers.get("Content-Length") || 0;
      if (!res.body) { const b = await res.arrayBuffer(); report(1); return b; }
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        if (total) report(Math.min(got / total, 0.99));
      }
      const buf = new Uint8Array(got);
      let pos = 0;
      for (const c of chunks) { buf.set(c, pos); pos += c.length; }
      report(1);
      return buf.buffer;
    })().finally(() => downloads.delete(url));
    downloads.set(url, d);
  }
  if (onProgress) { d.listeners.add(onProgress); onProgress(d.progress); }
  return d.promise;
}

// Alle Downloads ausser den noch gebrauchten (aktueller + naechster Titel) abbrechen.
function pruneDownloads(keepUrls) {
  for (const [url, d] of downloads) if (!keepUrls.has(url)) { d.controller.abort(); downloads.delete(url); }
}

async function sourceFor(track, onProgress) {
  if (!isTape(track.url)) return track.url;
  if (state.blobs.has(track.url)) return state.blobs.get(track.url);
  let data = await downloadTape(track.url, onProgress);
  let plain;
  try {
    plain = await decryptTape(data);
  } catch (e) {
    if (!fromCache.has(track.url)) throw e;
    // Unbrauchbarer Zwischenspeicher-Eintrag: verwerfen und einmal frisch laden.
    try { await (await caches.open(TAPE_CACHE)).delete(track.url); } catch {}
    data = await downloadTape(track.url, onProgress, true);
    plain = await decryptTape(data);
  }
  // Erst nach erfolgreicher Entschluesselung speichern (nur, was nicht schon drin ist).
  if (!fromCache.has(track.url)) storeTape(track.url, data);
  const inner = track.url.split("?")[0].replace(/\.tape$/i, "");
  const ext = (inner.split(".").pop() || "mp3").toLowerCase();
  const blobUrl = URL.createObjectURL(new Blob([plain], { type: MIME[ext] || "audio/mpeg" }));
  // Nur aktuellen und naechsten Titel im Speicher halten.
  const keep = new Set(state.playlist.tracks.slice(state.index, state.index + 2).map(t => t.url));
  for (const [u, b] of state.blobs) if (!keep.has(u)) { URL.revokeObjectURL(b); state.blobs.delete(u); }
  state.blobs.set(track.url, blobUrl);
  return blobUrl;
}

function renderLoad(p) {
  const el = $("loadInfo");
  if (!el) return;
  el.textContent = state.buffering ? `${T.loadingShort} ${Math.floor((p || 0) * 100)} %` : "";
}

async function select(index, autoplay) {
  const pl = state.playlist;
  if (!pl || !pl.tracks[index]) return;
  state.index = index;
  state.playWhenReady = autoplay;
  const track = pl.tracks[index];
  const token = ++state.token;
  // Titelwechsel: Band steht, bis der neue Titel bereit ist (die Absicht traegt playWhenReady).
  audio.pause();
  state.playing = false;
  state.srcReady = false;
  if (!state.seekDir) state.seekToEnd = false;
  state.buffering = isTape(track.url) && !state.blobs.has(track.url);
  // Ueberholte Downloads abbrechen – sonst teilen sich mehrere grosse Dateien die Leitung.
  pruneDownloads(new Set(pl.tracks.slice(index, index + 2).map(t => t.url)));
  render();
  renderLoad(0);
  try {
    const src = await sourceFor(track, p => { if (token === state.token) renderLoad(p); });
    if (token !== state.token) return;
    state.buffering = false;
    audio.src = src;
    state.srcReady = true;
    // Waehrend gespult wird nicht starten – das macht endSeek.
    if (state.playWhenReady && !state.seekDir) play();
    prefetch(index + 1);
  } catch (e) {
    if (token !== state.token || (e && e.name === "AbortError")) return;
    state.buffering = false;
    showStatus("error", T.errTrack);
  }
  renderLoad(1);
  updateMediaSession();
  render();
}

function prefetch(index) {
  const t = state.playlist && state.playlist.tracks[index];
  if (t && isTape(t.url) && !state.blobs.has(t.url)) sourceFor(t).catch(() => {});
}

function play() {
  if (!currentTrack()) return;
  if (state.buffering || !state.srcReady) {
    state.playWhenReady = true;
    if (!state.buffering) select(state.index, true); else render();
    return;
  }
  audio.play().catch(() => {});
}
function pause() { state.playWhenReady = false; audio.pause(); render(); }
function togglePlay() { wantPlay() ? pause() : play(); }
function stop() { state.playWhenReady = false; audio.pause(); render(); }
function next() {
  const pl = state.playlist;
  if (pl && state.index + 1 < pl.tracks.length) select(state.index + 1, wantPlay());
}
function previous() {
  if (audio.currentTime > 3 || state.index === 0) { if (state.srcReady) audio.currentTime = 0; render(); }
  else select(state.index - 1, wantPlay());
}

// Ereignisse des stummen Freischalt-Tons und des Neustarts (kickMusic) aendern keinen Zustand.
// Zustand folgt dem tatsaechlichen Abspielelement. Ausnahmen: stummer Freischalt-Ton
// (noch kein Titel bereit), Spulen und der kurze Neustart in kickMusic.
audio.addEventListener("play", () => { if (!state.srcReady) return; state.playing = true; render(); updateMediaSession(); });
audio.addEventListener("pause", () => { if (!state.srcReady || state.kicking || state.seekDir) return; state.playing = false; render(); updateMediaSession(); });
audio.addEventListener("loadedmetadata", () => {
  // Beim Zurueckspulen ueber den Titelanfang: im vorigen Titel kurz vor dem Ende weiter.
  if (state.seekToEnd && state.srcReady) { state.seekToEnd = false; audio.currentTime = Math.max(audio.duration - SEEK_STEP, 0); renderTime(); }
});

// iPhone/iPad: am Geraetetyp erkennen (iPadOS meldet sich als Mac mit Touch). Zusaetzlich,
// falls ein Browser das Setzen der Lautstaerke sichtbar verweigert.
const IOS_AUDIO = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  || (() => { const a = new Audio(); a.volume = 0.5; return Math.abs(a.volume - 0.5) > 0.01; })();

function kickMusic() {
  if (!IOS_AUDIO || audio.paused || !state.srcReady || state.kicking) return;
  state.kicking = true;
  setTimeout(() => {
    const t = audio.currentTime;
    audio.pause();
    audio.currentTime = t;
    audio.play().catch(() => {}).finally(() => {
      state.kicking = false;
      if (!state.seekDir) state.playing = !audio.paused;
      render(); updateMediaSession();
    });
  }, 120);
}
audio.addEventListener("timeupdate", renderTime);
audio.addEventListener("loadedmetadata", renderTime);
audio.addEventListener("ended", () => {
  const pl = state.playlist;
  if (pl && state.index + 1 < pl.tracks.length) select(state.index + 1, true);
  else { state.playing = false; render(); }
});

// Spulen
function beginSeek(dir) {
  if (!currentTrack() || state.seekDir) return;
  state.resumeAfterSeek = wantPlay();
  state.playWhenReady = false;
  state.seekDir = dir;
  audio.pause();
  fx.begin(dir);
  seekStep();
  render();
}
function seekStep() {
  const dir = state.seekDir;
  // Erst weiter, wenn der (neue) Titel bereit ist – sonst springt es mehrere Titel.
  if (!dir || !state.srcReady || audio.readyState < 1 || state.seekToEnd) return;
  const dur = audio.duration || (currentTrack().duration || 0);
  let target = audio.currentTime + dir * SEEK_STEP;
  if (dur && target >= dur - 0.5) {
    const pl = state.playlist;
    if (state.index + 1 < pl.tracks.length) { select(state.index + 1, false); return; }
    target = Math.max(dur - 0.5, 0);
  }
  if (target < 0) {
    if (state.index > 0 && audio.currentTime < 0.1) {
      state.seekToEnd = true;
      select(state.index - 1, false);
      return;
    }
    target = 0;
  }
  audio.currentTime = target;
  renderTime();
}
function endSeek() {
  if (!state.seekDir) return;
  state.seekDir = 0;
  fx.end();
  if (state.resumeAfterSeek) play(); else { state.playing = false; audio.pause(); }
  render();
}

// ---------------------------------------------------------------- Tasten
function bindKey(el, tap, dir) {
  let holdTimer = null, stepTimer = null, held = false, down = false;
  const release = cancel => {
    if (!down) return;
    down = false;
    el.classList.remove("down");
    fx.click("key_up");
    clearTimeout(holdTimer); clearInterval(stepTimer);
    if (held) endSeek(); else if (!cancel) tap();
  };
  el.addEventListener("pointerdown", e => {
    e.preventDefault();
    down = true; held = false;
    el.classList.add("down");
    fx.click("key_down");
    try { el.setPointerCapture(e.pointerId); } catch {}
    if (!dir) return;
    holdTimer = setTimeout(() => {
      held = true;
      beginSeek(dir);
      stepTimer = setInterval(seekStep, 100);
    }, 400);
  });
  el.addEventListener("pointerup", () => release(false));
  el.addEventListener("pointercancel", () => release(true));
  el.addEventListener("contextmenu", e => e.preventDefault());
  // Tastatur/VoiceOver
  el.addEventListener("click", e => { if (e.detail === 0) tap(); });
}
bindKey($("rewKey"), previous, -1);
bindKey($("ffKey"), next, 1);
bindKey($("playKey"), togglePlay);
bindKey($("stopKey"), stop);
bindKey($("ejectKey"), openShelf);
$("emptySlot").addEventListener("click", openShelf);
$("shareBtn").addEventListener("pointerdown", () => fx.click("key_down"));
$("shareBtn").addEventListener("pointerup", () => fx.click("key_up"));
$("shareBtn").addEventListener("click", openShare);

// ---------------------------------------------------------------- Darstellung
const SHELLS = ["#edebe0", "#c7291f", "#f2bd29", "#295c9e", "#333338", "#5c9466"];
function shellColor(band) {
  let sum = 5381;
  for (const ch of band) sum = (Math.imul(sum, 33) + ch.codePointAt(0)) >>> 0;
  return SHELLS[sum % SHELLS.length];
}

function fitText(el, text, maxWidth) {
  el.textContent = text;
  el.removeAttribute("textLength");
  el.removeAttribute("lengthAdjust");
  try {
    if (el.getComputedTextLength() > maxWidth) {
      el.setAttribute("textLength", maxWidth);
      el.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
  } catch {}
}

function showStatus(kind, msg) {
  const el = $("status");
  if (!kind) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  $("cassette").toggleAttribute("hidden", true);
  if (state.imageTape) state.imageTape.svg.toggleAttribute("hidden", true);
  $("emptySlot").hidden = true;
  if (kind === "loading") el.innerHTML = `<span class="spinner"></span><span class="hand">${T.loading}</span>`;
  else {
    el.innerHTML = "";
    const p = document.createElement("div"); p.textContent = msg;
    const b = document.createElement("button"); b.className = "secondary"; b.textContent = T.other;
    b.onclick = openShelf;
    el.append(p, b);
  }
}

function render() {
  const pl = state.playlist, track = currentTrack();
  const hasTape = !!pl && $("status").hidden;
  const custom = hasTape && state.imageTape;
  $("cassette").toggleAttribute("hidden", !hasTape || !!custom);
  if (state.imageTape) {
    state.imageTape.svg.toggleAttribute("hidden", !custom);
    if (state.imageTape.title) fitText(state.imageTape.title, track ? track.title : "", state.imageTape.titleWidth);
  }
  $("emptySlot").hidden = !!pl || !$("status").hidden;
  $("shareBtn").hidden = !pl;
  $("jcard").hidden = !pl;
  if (pl) {
    $("shell").style.fill = shellColor(pl.band);
    document.querySelector(".cassette .trap").style.fill = shellColor(pl.band);
    fitText($("bandName"), pl.band, 222);
    fitText($("trackName"), track ? track.title : "", 244);
    $("trackNo").textContent = `${state.index + 1}/${pl.tracks.length}`;
    $("jBand").textContent = pl.band;
    $("jTape").textContent = pl.tape || "";
    const ol = $("jTracks");
    if (ol.dataset.src !== pl.source) {
      ol.dataset.src = pl.source;
      ol.innerHTML = "";
      pl.tracks.forEach(t => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="n">${t.id + 1}.</span><span class="t"></span>`;
        li.querySelector(".t").textContent = t.title;
        li.onclick = () => select(t.id, true);
        ol.appendChild(li);
      });
    }
    [...ol.children].forEach((li, i) => li.classList.toggle("on", i === state.index));
    document.title = `${track ? track.title + " · " : ""}${pl.band} – DemoTape`;
  } else {
    $("trackNo").textContent = "";
    document.title = "DemoTape";
  }
  $("led").classList.toggle("on", state.playing || !!state.seekDir);
  $("spinner").hidden = !state.buffering;
  // Leuchte blinkt: Wiedergabe gewuenscht, Titel laedt noch.
  $("led").classList.toggle("wait", state.buffering && state.playWhenReady);
  if (!state.buffering) renderLoad(1);
  $("playIcon").setAttribute("d", wantPlay() ? "M6 5h4v14H6zM14 5h4v14h-4z" : "M7 5v14l12-7z");
  $("playKey").setAttribute("aria-label", wantPlay() ? T.pause : T.play);
  $("rewKey").classList.toggle("down", state.seekDir < 0);
  $("ffKey").classList.toggle("down", state.seekDir > 0);
  renderTime();
}

function renderTime() {
  const s = Math.max(0, Math.floor(audio.currentTime || 0));
  const digits = String(Math.min(Math.floor(s / 60), 99)).padStart(2, "0") + String(s % 60).padStart(2, "0");
  const b = $("counter").querySelectorAll("b");
  for (let i = 0; i < 4; i++) b[i].textContent = digits[i];
  if ("mediaSession" in navigator && audio.duration && isFinite(audio.duration)) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch {}
  }
}

// Spulen und Bandwickel
let angle = 0, lastT = 0;
function animate(t) {
  const dt = lastT ? (t - lastT) / 1000 : 0;
  lastT = t;
  const speed = state.seekDir ? 3 * state.seekDir : state.playing ? 0.35 : 0;
  angle = (angle + dt * speed * 360) % 360000;
  const pl = state.playlist;
  let p = 0;
  if (pl) {
    const dur = audio.duration || (currentTrack() && currentTrack().duration) || 0;
    const inTrack = dur ? Math.min((audio.currentTime || 0) / dur, 1) : 0;
    p = (state.index + inTrack) / pl.tracks.length;
  }
  const minR = 14, maxR = 37;
  const rL = minR + (maxR - minR) * Math.sqrt(1 - p);
  const rR = minR + (maxR - minR) * Math.sqrt(p);
  $("packL").setAttribute("r", rL.toFixed(2));
  $("packR").setAttribute("r", rR.toFixed(2));
  $("hubL").setAttribute("transform", `translate(120 126) rotate(${(angle * rR / rL).toFixed(1)})`);
  $("hubR").setAttribute("transform", `translate(194 126) rotate(${angle.toFixed(1)})`);
  if (state.imageTape) {
    // Linke Nabe (Abwickelspule) dreht etwas schneller – wie beim echten Band.
    state.imageTape.spins.forEach((sp, i) => sp.el.setAttribute("transform",
      `rotate(${(i === 0 ? angle * 1.25 : angle).toFixed(1)} ${sp.cx.toFixed(1)} ${sp.cy.toFixed(1)})`));
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// ---------------------------------------------------------------- Sperrbildschirm / Medientasten
function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const pl = state.playlist, t = currentTrack();
  if (!pl || !t) { navigator.mediaSession.metadata = null; return; }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: t.artist || pl.band, album: pl.tape || "DemoTape",
    artwork: [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }],
  });
  navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
}
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const on = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
  on("play", play); on("pause", pause); on("stop", stop);
  on("previoustrack", previous); on("nexttrack", next);
  on("seekto", d => { if (audio.src) audio.currentTime = d.seekTime; });
  on("seekbackward", d => { if (audio.src) audio.currentTime = Math.max(audio.currentTime - (d.seekOffset || 10), 0); });
  on("seekforward", d => { if (audio.src) audio.currentTime += d.seekOffset || 10; });
}

// ---------------------------------------------------------------- Tape einlegen
function playlistURLFromInput(input) {
  let v = input.trim();
  if (!v) return null;
  if (!/^[a-z]+:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    const inner = u.searchParams.get("list");
    if (inner) return playlistURLFromInput(inner);
    // Lokaler Test (http://localhost) darf auch http-Playlists laden.
    return u.protocol === "https:" || location.hostname === "localhost" ? u.href : null;
  } catch { return null; }
}

function openShelf() {
  const list = store.get();
  const ul = $("recent");
  ul.innerHTML = "";
  $("recentHead").hidden = !list.length;
  for (const e of list) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<span class="hand"></span><small></small>`;
    b.querySelector(".hand").textContent = e.band;
    b.querySelector("small").textContent = e.tape || "";
    b.onclick = () => { $("shelf").close(); loadPlaylist(e.url); };
    const del = document.createElement("button");
    del.type = "button"; del.className = "del"; del.textContent = "✕";
    del.setAttribute("aria-label", T.remove);
    del.onclick = () => { store.remove(e.url); openShelf(); };
    li.append(b, del);
    ul.appendChild(li);
  }
  $("inputError").hidden = true;
  if (!$("shelf").open) $("shelf").showModal();
}

$("shelfForm").addEventListener("submit", e => {
  if (e.submitter && e.submitter.value === "cancel") return;
  e.preventDefault();
  const url = playlistURLFromInput($("listInput").value);
  if (!url) { $("inputError").hidden = false; return; }
  $("shelf").close();
  loadPlaylist(url);
});

// ---------------------------------------------------------------- Teilen
function shareURL() {
  return location.origin + location.pathname + "?list=" + encodeURIComponent(state.playlist.source);
}
function openShare() {
  const link = shareURL();
  $("shareBand").textContent = state.playlist.band;
  $("shareLink").textContent = link;
  const qr = qrcode(0, "M"); qr.addData(link); qr.make();
  $("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  $("copyBtn").textContent = T.copy;
  $("nativeShare").hidden = !navigator.share;
  $("share").showModal();
}
$("shareClose").onclick = () => $("share").close();
$("copyBtn").onclick = async () => {
  try { await navigator.clipboard.writeText(shareURL()); $("copyBtn").textContent = T.copied; } catch {}
};
$("nativeShare").onclick = () => {
  navigator.share({ title: `${state.playlist.band} – DemoTape`, url: shareURL() }).catch(() => {});
};
// Klick auf den Hintergrund schliesst Dialoge
for (const d of [$("shelf"), $("share")]) {
  d.addEventListener("click", e => { if (e.target === d) d.close(); });
}

// ---------------------------------------------------------------- Start
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
(async () => {
  try { await document.fonts.ready; } catch {}
  const param = new URLSearchParams(location.search).get("list");
  const fromParam = param && playlistURLFromInput(param);
  const last = store.get()[0];
  if (fromParam) loadPlaylist(fromParam);
  else if (last) loadPlaylist(last.url);
  else { render(); openShelf(); }
})();
