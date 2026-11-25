// The Last Island — map page: camera, input, mist, search and the info cards.
import { ISO_K, CLAN_COLORS, iso, normalizeHandle } from "./geo.js";
import { buildScene, drawObject } from "./scene.js";
import { paintSea, paintMist, drawPill } from "./render.js";
import { validateData } from "./data.js";
import { createPlay } from "./play.js";
import { DeviceStore, OnlineStore } from "./store.js";
import { SUPABASE_URL, SUPABASE_KEY, INSTAGRAM_HANDLE } from "./config.js";

const $ = id => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");
const MIN_ZOOM = 0.12, MAX_ZOOM = 5, LABEL_ZOOM = 2, MAX_LABELS = 120;

let data, scene;
let vw = 0, vh = 0, dpr = 1;
const cam = { x: 0, y: 0, z: 1 };
let flight = null;          // { x, y, z } camera target while flying
let selected = null;        // house object
let showNames = true;
let play = null;            // Play panel controller
const tierOverride = new Map(); // handle -> tier built in play (shown before the next daily rebuild)

const withTier = o => (o.kind === "house" && tierOverride.has(o.handle) ? { ...o, tier: tierOverride.get(o.handle) } : o);

// ------------------------------------------------------------------ camera
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  vw = window.innerWidth; vh = window.innerHeight;
  canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
}

function clampCam() {
  const lim = (data.island_radius + 4) * ISO_K;
  cam.z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.z));
  cam.x = Math.min(lim, Math.max(-lim, cam.x));
  cam.y = Math.min(lim / 2, Math.max(-lim / 2, cam.y));
}

function fitZoom() {
  const r = (data.mist_radius + 3) * ISO_K;
  return Math.min(vw / (1.8 * r), (vh - 120) / (1.1 * r));
}

let touched = false; // until the user pans/zooms, keep the island fitted to the window

function fitView() {
  cam.z = fitZoom();
  [cam.x, cam.y] = iso(0, 0);
  cam.y += 10;
  clampCam();
}

function toIso(px, py) { return [cam.x + (px - vw / 2) / cam.z, cam.y + (py - vh / 2) / cam.z]; }
function toScreen(ix, iy) { return [(ix - cam.x) * cam.z + vw / 2, (iy - cam.y) * cam.z + vh / 2]; }

function zoomAt(px, py, factor) {
  const [ix, iy] = toIso(px, py);
  cam.z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.z * factor));
  cam.x = ix - (px - vw / 2) / cam.z;
  cam.y = iy - (py - vh / 2) / cam.z;
  flight = null; touched = true; clampCam();
}

function flyTo(house, z = 2.4) {
  flight = { x: house.sx, y: house.sy - 12, z };
  touched = true;
}

// ------------------------------------------------------------------ drawing
const drawSea = () => paintSea(ctx, vw, vh);
const drawMist = t => paintMist(ctx, data, t, (vw + vh) / cam.z);

/** Iso-space rectangle on screen, padded by `pad` screen px (computed once per frame). */
function viewBounds(pad) {
  const [l, t] = toIso(-pad, -pad), [r, b] = toIso(vw + pad, vh + pad * 2);
  return { l, t, r, b };
}

const inView = (o, v) => o.sx > v.l && o.sx < v.r && o.sy > v.t && o.sy < v.b;

function drawLive() {
  const v = viewBounds(60);
  for (const o of scene.objects) if (inView(o, v)) drawObject(ctx, withTier(o), o.sx, o.sy);
}

const label = (text, x, y, strong) => drawPill(ctx, text, x, y, strong ? "strong" : "small");

function drawLabels() {
  if (!showNames || cam.z < LABEL_ZOOM) return;
  const placed = [];
  const overlaps = (x, y, w) => placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < 17);
  ctx.font = '500 11px "Nunito", system-ui, sans-serif';
  const v = viewBounds(20), list = scene.houseList;
  for (let i = list.length - 1; i >= 0 && placed.length < MAX_LABELS; i--) { // front-most first
    const o = list[i];
    if (o === selected || !inView(o, v)) continue;
    const [x, y] = toScreen(o.sx, o.sy - 30);
    const text = "@" + o.handle, w = ctx.measureText(text).width + 10;
    if (overlaps(x, y, w)) continue;
    placed.push({ x, y, w });
    label(text, x, y, false);
  }
}

/** Selected house is redrawn on top (in iso space) so trees never hide it. */
function drawSelectedHouse(t) {
  if (!selected) return;
  const pulse = 1 + 0.15 * Math.sin(t / 250);
  ctx.strokeStyle = "rgba(255,210,110,.95)"; ctx.lineWidth = 3 / cam.z;
  ctx.beginPath(); ctx.ellipse(selected.sx, selected.sy, 22 * pulse, 11 * pulse, 0, 0, 6.283); ctx.stroke();
  drawObject(ctx, withTier(selected), selected.sx, selected.sy);
}

function drawSelectedLabel() {
  if (!selected) return;
  const [x, y] = toScreen(selected.sx, selected.sy);
  label("@" + selected.handle, x, y - 44 * cam.z, true);
}

function frame(t) {
  if (flight) {
    cam.x += (flight.x - cam.x) * 0.12; cam.y += (flight.y - cam.y) * 0.12; cam.z += (flight.z - cam.z) * 0.1;
    const done = Math.abs(flight.x - cam.x) < 0.5 && Math.abs(flight.y - cam.y) < 0.5 && Math.abs(flight.z - cam.z) < 0.01;
    if (done) flight = null;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSea();
  ctx.setTransform(cam.z * dpr, 0, 0, cam.z * dpr, (vw / 2 - cam.x * cam.z) * dpr, (vh / 2 - cam.y * cam.z) * dpr);
  const live = cam.z * dpr > scene.scale * 1.25;
  ctx.drawImage(live ? scene.terrain : scene.cache, -scene.halfW, -scene.halfH, scene.halfW * 2, scene.halfH * 2);
  if (live) drawLive();
  drawSelectedHouse(t);
  drawMist(t);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLabels();
  drawSelectedLabel();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ input
const pointers = new Map();
let gesture = null;

function houseAt(px, py) {
  const [ix, iy] = toIso(px, py), reach = 16 / Math.min(1, cam.z);
  let best = null;
  for (const o of scene.houseList) {
    if (Math.abs(o.sx - ix) < reach && iy > o.sy - 30 && iy < o.sy + 8 && (!best || o.depth > best.depth)) best = o;
  }
  return best;
}

canvas.addEventListener("pointerdown", e => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) gesture = { moved: 0, start: performance.now() };
  else if (gesture) gesture.moved = 99; // a second finger means this is never a tap
  flight = null;
  touched = true;
});

canvas.addEventListener("pointermove", e => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  if (pointers.size === 1) {
    cam.x -= (cur.x - prev.x) / cam.z; cam.y -= (cur.y - prev.y) / cam.z;
    if (gesture) gesture.moved += Math.hypot(cur.x - prev.x, cur.y - prev.y);
  } else if (pointers.size === 2) {
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
    const before = Math.hypot(prev.x - other.x, prev.y - other.y);
    const after = Math.hypot(cur.x - other.x, cur.y - other.y);
    const midX = (cur.x + other.x) / 2, midY = (cur.y + other.y) / 2;
    cam.x -= (midX - (prev.x + other.x) / 2) / cam.z; // two-finger pan
    cam.y -= (midY - (prev.y + other.y) / 2) / cam.z;
    if (before > 0) zoomAt(midX, midY, after / before);
  }
  pointers.set(e.pointerId, cur);
  clampCam();
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  if (pointers.size === 1 && gesture && gesture.moved < 6 && performance.now() - gesture.start < 450) {
    const hit = houseAt(e.clientX, e.clientY);
    if (hit) select(hit, false);
  }
  pointers.delete(e.pointerId);
  if (!pointers.size) gesture = null;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); gesture = null; });
canvas.addEventListener("wheel", e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

// ------------------------------------------------------------------ UI
function shareUrl(handle) {
  const u = new URL(location.href);
  u.search = ""; u.hash = ""; u.searchParams.set("h", handle);
  return u.toString();
}

function showCard(kind, house, handle) {
  $("found").hidden = kind !== "found";
  $("missing").hidden = kind !== "missing";
  if (kind === "found") {
    $("found-name").textContent = "@" + house.handle;
    $("found-job").textContent = data.jobs[house.job];
    $("found-home").textContent = data.tiers[withTier(house).tier];
    $("play-as").textContent = "@" + house.handle;
    $("found-clan").textContent = data.clans[house.clan];
    $("found-clan").style.setProperty("--clan", CLAN_COLORS[house.clan]);
  } else if (kind === "missing") {
    $("missing-name").textContent = "@" + handle;
  }
}

function select(house, fly = true) {
  selected = house;
  showCard("found", house);
  if (fly) flyTo(house);
  history.replaceState(null, "", shareUrl(house.handle));
}

function search(raw) {
  const handle = normalizeHandle(raw);
  if (!handle) return;
  const house = scene.houses.get(handle);
  if (house) select(house); else { selected = null; showCard("missing", null, handle); }
}

$("search").addEventListener("submit", e => { e.preventDefault(); search($("q").value); $("q").blur(); });
$("zoom-in").addEventListener("click", () => zoomAt(vw / 2, vh / 2, 1.5));
$("zoom-out").addEventListener("click", () => zoomAt(vw / 2, vh / 2, 1 / 1.5));
$("names").addEventListener("click", () => {
  showNames = !showNames;
  $("names").setAttribute("aria-pressed", String(showNames));
});
$("share").addEventListener("click", async () => {
  if (!selected) return;
  const url = shareUrl(selected.handle), text = `My house on The Last Island @${selected.handle}`;
  try {
    if (navigator.share) await navigator.share({ title: "The Last Island", text, url });
    else { await navigator.clipboard.writeText(url); $("share").textContent = "Link copied"; }
  } catch { /* user closed the share sheet */ }
});
/** Fly so the house sits in the visible gap between the header card and the play panel. */
function focusAbovePanel(house) {
  const top = $("head").getBoundingClientRect().bottom;
  const bottom = $("play").getBoundingClientRect().top;
  const z = Math.max(cam.z, 1.6);
  const targetY = (top + bottom) / 2 + 20 * z; // +20: houses stand above their ground point
  flight = { x: house.sx, y: house.sy + (vh / 2 - targetY) / z, z };
  touched = true;
}

$("play-btn").addEventListener("click", async () => {
  if (!selected || !play) return;
  try {
    await play.open(withTier(selected));
    focusAbovePanel(selected);
  } catch {
    $("share").focus();
  }
});
$("head").addEventListener("click", () => {
  const open = $("head").classList.toggle("open");
  $("head").setAttribute("aria-expanded", String(open));
});
document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => {
  selected = null; showCard("none"); $("share").textContent = "Share my house";
}));

/** @param {number} extra lanterns lit in play since the last daily rebuild */
function showGoal(extra) {
  const lit = data.lanterns_lit + extra;
  $("goal-count").textContent = `${lit.toLocaleString()} / ${data.lantern_goal.toLocaleString()} lanterns lit`;
  $("goal-bar").style.width = `${Math.min(100, (100 * lit) / data.lantern_goal)}%`;
}

function fillHeader() {
  $("day").textContent = `Day ${data.day}`;
  $("settlers").textContent = `${data.settlers.toLocaleString()} settlers`;
  $("goal-title").textContent = data.goal_title;
  showGoal(0);
  $("vote").hidden = !data.vote;
  $("vote-text").textContent = data.vote;
  $("wish").hidden = !data.wish;
  $("wish-text").textContent = data.wish;
  $("wish-by").textContent = data.wish_by ? "— wished by @" + data.wish_by : "";
  const clans = $("clans");
  data.clans.forEach((name, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.setProperty("--clan", CLAN_COLORS[i]);
    chip.textContent = `${name} ${data.clan_counts[i].toLocaleString()}`;
    clans.append(chip);
  });
}

async function start() {
  try {
    const res = await fetch("data.json?v=" + Date.now());
    if (!res.ok) throw new Error(`data.json: HTTP ${res.status}`);
    data = validateData(await res.json());
    resize();
    scene = buildScene(data);
  } catch (err) {
    $("loading").textContent = "The mist is too thick right now. Please try again in a moment.";
    throw err;
  }
  fillHeader();
  fitView();
  const store = SUPABASE_URL && SUPABASE_KEY
    ? new OnlineStore(SUPABASE_URL, SUPABASE_KEY, data.clans.length)
    : new DeviceStore(data.clans.length);
  const refreshGoal = () => store.getIsland().then(island => showGoal(island.lanterns));
  play = createPlay({
    data, store, instagram: INSTAGRAM_HANDLE,
    onTier: (handle, tier) => {
      tierOverride.set(handle, tier);
      if (selected && selected.handle === handle) showCard("found", selected);
    },
    onIsland: refreshGoal,
    onClose: () => { if (selected) showCard("found", selected); },
  });
  refreshGoal();
  // Houses built in play (server or this device) beat the day-based tier in data.json.
  store.getTiers().then(rows => {
    for (const [handle, tier] of rows) {
      const house = scene.houses.get(handle);
      if (house && tier > house.tier) tierOverride.set(handle, tier);
    }
  });
  window.addEventListener("resize", () => {
    resize();
    if (!touched) fitView(); else clampCam();
  });
  const wanted = new URLSearchParams(location.search).get("h");
  if (wanted) search(wanted);
  $("loading").classList.add("gone");
  requestAnimationFrame(frame);
}

start();
