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
  let tape = null, band = null, info = null;
  const tracks = [];
  for (const line of lines) {
    if (line.startsWith("#")) {
      const up = line.toUpperCase();
      const val = () => line.slice(line.indexOf(":") + 1).trim();
      if (up.startsWith("#PLAYLIST:") || up.startsWith("#EXTALB:")) tape = tape || val() || null;
      else if (up.startsWith("#EXTART:")) band = val() || band;
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
  return { source: base, band, tape, tracks };
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
  ctx: null, buffers: {}, loop: null, gain: null,
  async init() {
    unlockAudio();
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    // iOS: Web Audio sonst stumm bei Stummschalter.
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.5;
    this.gain.connect(this.ctx.destination);
    await Promise.all(["wind_loop", "key_down", "key_up"].map(async n => {
      try {
        const data = await (await fetch(`sounds/${n}.wav`)).arrayBuffer();
        this.buffers[n] = await new Promise((ok, err) => this.ctx.decodeAudioData(data, ok, err));
      } catch {}
    }));
  },
  click(name) {
    const b = this.buffers[name];
    if (!this.ctx || !b) return;
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = 1.6;
    s.buffer = b; s.connect(g).connect(this.ctx.destination); s.start();
  },
  begin(dir) {
    if (!this.ctx) return;
    this.click("key_down");
    this.stopLoop(0);
    const b = this.buffers.wind_loop;
    if (!b) return;
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
    if (!this.ctx) return;
    this.click("key_up");
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

// ---------------------------------------------------------------- Player
const audio = new Audio();
audio.preload = "auto";
const SEEK_STEP = 1.5;

// iOS Safari erlaubt play() nur innerhalb einer Beruehrung. Verschluesselte Titel starten aber
// erst nach dem Laden – deshalb wird das Element beim ersten Tippen einmal stumm "entsperrt".
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked || state.srcReady) { audioUnlocked = true; return; }
  audioUnlocked = true;
  const header = new Uint8Array([82,73,70,70,40,0,0,0,87,65,86,69,102,109,116,32,16,0,0,0,1,0,1,0,
    68,172,0,0,136,88,1,0,2,0,16,0,100,97,116,97,4,0,0,0,0,0,0,0]);
  audio.src = URL.createObjectURL(new Blob([header], { type: "audio/wav" }));
  audio.play().then(() => { if (!state.srcReady) audio.pause(); }).catch(() => {});
}

const state = {
  playlist: null, index: 0, playing: false, seekDir: 0, buffering: false,
  playWhenReady: false, resumeAfterSeek: false, token: 0, srcReady: false,
  blobs: new Map(), // track-URL -> Object-URL (entschluesselt, nur im Speicher)
};

function currentTrack() {
  const pl = state.playlist;
  return pl && pl.tracks[state.index];
}

async function loadPlaylist(url) {
  const token = ++state.token;
  stop();
  state.srcReady = false;
  audio.removeAttribute("src"); audio.load();
  for (const u of state.blobs.values()) URL.revokeObjectURL(u);
  state.blobs.clear();
  state.playlist = null;
  showStatus("loading");
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("load");
    const pl = parseM3U(await res.text(), res.url || url);
    if (token !== state.token) return;
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

async function sourceFor(track) {
  if (!isTape(track.url)) return track.url;
  if (state.blobs.has(track.url)) return state.blobs.get(track.url);
  const res = await fetch(track.url);
  if (!res.ok) throw new Error("track");
  const plain = await decryptTape(await res.arrayBuffer());
  const inner = track.url.split("?")[0].replace(/\.tape$/i, "");
  const ext = (inner.split(".").pop() || "mp3").toLowerCase();
  const blobUrl = URL.createObjectURL(new Blob([plain], { type: MIME[ext] || "audio/mpeg" }));
  // Nur aktuellen und naechsten Titel im Speicher halten.
  const keep = new Set(state.playlist.tracks.slice(state.index, state.index + 2).map(t => t.url));
  for (const [u, b] of state.blobs) if (!keep.has(u)) { URL.revokeObjectURL(b); state.blobs.delete(u); }
  state.blobs.set(track.url, blobUrl);
  return blobUrl;
}

async function select(index, autoplay) {
  const pl = state.playlist;
  if (!pl || !pl.tracks[index]) return;
  state.index = index;
  state.playWhenReady = autoplay;
  const track = pl.tracks[index];
  const token = ++state.token;
  audio.pause();
  state.srcReady = false;
  state.buffering = isTape(track.url) && !state.blobs.has(track.url);
  render();
  try {
    const src = await sourceFor(track);
    if (token !== state.token) return;
    state.buffering = false;
    audio.src = src;
    state.srcReady = true;
    if (state.playWhenReady) play();
    prefetch(index + 1);
  } catch {
    if (token !== state.token) return;
    state.buffering = false;
    showStatus("error", T.errTrack);
  }
  updateMediaSession();
  render();
}

function prefetch(index) {
  const t = state.playlist && state.playlist.tracks[index];
  if (t && isTape(t.url) && !state.blobs.has(t.url)) sourceFor(t).catch(() => {});
}

function play() {
  if (!currentTrack()) return;
  if (state.buffering || !state.srcReady) { state.playWhenReady = true; if (!state.buffering) select(state.index, true); return; }
  audio.play().catch(() => {});
}
function pause() { state.playWhenReady = false; audio.pause(); }
function togglePlay() { state.playing ? pause() : play(); }
function stop() { audio.pause(); if (audio.src) audio.currentTime = 0; render(); }
function next() {
  const pl = state.playlist;
  if (pl && state.index + 1 < pl.tracks.length) select(state.index + 1, state.playing);
}
function previous() {
  if (audio.currentTime > 3 || state.index === 0) { if (audio.src) audio.currentTime = 0; render(); }
  else select(state.index - 1, state.playing);
}

audio.addEventListener("play", () => { state.playing = true; render(); updateMediaSession(); });
audio.addEventListener("pause", () => { if (!state.seekDir) state.playing = false; render(); updateMediaSession(); });
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
  state.resumeAfterSeek = state.playing;
  state.seekDir = dir;
  audio.pause();
  fx.begin(dir);
  seekStep();
  render();
}
function seekStep() {
  const dir = state.seekDir;
  if (!dir || !state.srcReady) return;
  const dur = audio.duration || (currentTrack().duration || 0);
  let target = audio.currentTime + dir * SEEK_STEP;
  if (dur && target >= dur - 0.5) {
    const pl = state.playlist;
    if (state.index + 1 < pl.tracks.length) { select(state.index + 1, false); return; }
    target = Math.max(dur - 0.5, 0);
  }
  if (target < 0) {
    if (state.index > 0 && audio.currentTime < 0.1) {
      select(state.index - 1, false).then(() => {
        audio.addEventListener("loadedmetadata", () => { audio.currentTime = Math.max(audio.duration - SEEK_STEP, 0); }, { once: true });
      });
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
  if (state.resumeAfterSeek) play(); else state.playing = false;
  render();
}

// ---------------------------------------------------------------- Tasten
function bindKey(el, tap, dir) {
  let holdTimer = null, stepTimer = null, held = false, down = false;
  const release = cancel => {
    if (!down) return;
    down = false;
    el.classList.remove("down");
    clearTimeout(holdTimer); clearInterval(stepTimer);
    if (held) endSeek(); else if (!cancel) tap();
  };
  el.addEventListener("pointerdown", e => {
    e.preventDefault();
    fx.init();
    down = true; held = false;
    el.classList.add("down");
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
  $("cassette").toggleAttribute("hidden", !hasTape);
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
        li.onclick = () => { fx.init(); select(t.id, true); };
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
  $("playIcon").setAttribute("d", state.playing ? "M6 5h4v14H6zM14 5h4v14h-4z" : "M7 5v14l12-7z");
  $("playKey").setAttribute("aria-label", state.playing ? T.pause : T.play);
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
    b.onclick = () => { $("shelf").close(); fx.init(); loadPlaylist(e.url); };
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
  fx.init();
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
