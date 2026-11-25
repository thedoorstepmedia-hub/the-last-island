// Film mode: renders the daily reel frame by frame for tools/make_video.py.
// Deterministic: frame(t) always draws the same picture for the same plan and time.
//
//   await film.init(plan)   -> { duration }
//   film.frame(t, quality)  -> JPEG data URL of the frame at t seconds
//
// plan = { data?, shots: [{ type: "wide"|"arrivals"|"landmark"|"outro", dur, text,
//                           handles?, allNew?, kind?, isNew?, gx?, gy? }] }
import { iso, ISO_K } from "./geo.js";
import { buildScene, drawObject } from "./scene.js";
import { validateData } from "./data.js";
import { paintSea, paintMist, drawPill } from "./render.js";
import { OnlineStore } from "./store.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const canvas = document.getElementById("film");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;
const CENTER = (() => { const [x, y] = iso(0, 0); return { x, y: y + 10 }; })();
const TITLE_Y = 300, TITLE_SIZE = 76;
const POP_TIME = 0.45;          // seconds a new house takes to rise
const MAX_GLOW_TAGS = 14;
const MAX_STOPS = 4;            // camera stops in the arrivals shot

let data, before, after, shots = [], reveal = new Map(), duration = 0, landmarkTarget = null;

// ------------------------------------------------------------------ easing + camera
const clamp01 = v => Math.max(0, Math.min(1, v));
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpCam = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)) });

function fitZ() {
  const r = (data.mist_radius + 2) * ISO_K;
  return Math.min(W / (2.05 * r), (H * 0.62) / (1.05 * r));
}

const wideCam = k => ({ ...CENTER, z: fitZ() * k });

/** Close-up of one group of new houses. */
function groupCam(houses) {
  const cx = houses.reduce((s, h) => s + h.sx, 0) / houses.length;
  const cy = houses.reduce((s, h) => s + h.sy, 0) / houses.length;
  const spread = Math.max(...houses.map(h => Math.hypot(h.sx - cx, (h.sy - cy) * 1.6)));
  const z = Math.max(1.5, Math.min(2.6, (W * 0.4) / (spread + 70)));
  return { x: cx, y: cy - 20, z };
}

/** Split today's houses into up to MAX_STOPS groups going round the island; the camera visits each. */
function arrivalGroups(handles) {
  const houses = handles.map(h => after.houses.get(h)).filter(Boolean)
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  if (!houses.length) return [];
  const k = Math.min(MAX_STOPS, Math.max(1, Math.round(houses.length / 4)));
  const size = Math.ceil(houses.length / k);
  const groups = [];
  for (let i = 0; i < houses.length; i += size) groups.push(houses.slice(i, i + size));
  return groups;
}

function shotPath(shot, prev) {
  switch (shot.type) {
    case "arrivals": {
      const groups = arrivalGroups(shot.handles || []);
      return { groups, path: [prev, ...(groups.length ? groups.map(groupCam) : [wideCam(1.9)])] };
    }
    case "landmark":
      return { path: [prev, landmarkTarget ? { x: landmarkTarget.sx, y: landmarkTarget.sy - 45, z: 3.0 } : wideCam(1.9)] };
    case "outro": return { path: [prev, wideCam(1.45)] };
    default: return { path: [prev, wideCam(1.75)] };
  }
}

function planShots(rawShots) {
  let t = 0, prev = wideCam(1.5);
  return rawShots.map(raw => {
    const shot = { ...raw, start: t, end: t + raw.dur, ...shotPath(raw, prev) };
    t = shot.end;
    prev = shot.path.at(-1);
    return shot;
  });
}

/** Camera along the shot's path: one eased move per leg, so it settles briefly at each stop. */
function camAt(shot, t) {
  const legs = shot.path.length - 1;
  const u = clamp01((t - shot.start) / shot.dur) * legs;
  const i = Math.min(legs - 1, Math.floor(u));
  return lerpCam(shot.path[i], shot.path[i + 1], easeInOut(u - i));
}

/** New houses rise one after another through the arrivals shot; today's wish rises in its shot. */
function planReveals(newLandmark) {
  const out = new Map();
  for (const shot of shots) {
    if (shot.type === "arrivals") {
      const leg = shot.dur / Math.max(1, shot.groups.length);
      for (const h of shot.allNew || []) out.set("h:" + h, shot.start + shot.dur * 0.5); // untagged extras
      shot.groups.forEach((group, g) => group.forEach((o, i) => // rise as the camera arrives at the group
        out.set("h:" + o.handle, shot.start + leg * (g + 0.5 + (0.45 * i) / group.length))));
    }
    if (shot.type === "landmark" && newLandmark) out.set(lotKey(newLandmark.gx, newLandmark.gy), shot.start + shot.dur * 0.35);
  }
  return out;
}

const lotKey = (gx, gy) => "l:" + gx + "," + gy;
const revealKey = o => (o.kind === "house" ? "h:" + o.handle : o.kind === "landmark" ? lotKey(o.gx, o.gy) : null);

// ------------------------------------------------------------------ drawing
function screenOf(cam, sx, sy) { return [(sx - cam.x) * cam.z + W / 2, (sy - cam.y) * cam.z + H / 2]; }

function setCamera(cam) {
  ctx.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
}

function inView(cam, o) {
  const [x, y] = screenOf(cam, o.sx, o.sy);
  return x > -200 && x < W + 200 && y > -100 && y < H + 400;
}

function drawRising(o, p) {
  ctx.save();
  ctx.translate(o.sx, o.sy);
  const s = Math.max(0.01, easeOutBack(p));
  ctx.scale(1, s);
  drawObject(ctx, o, 0, 0);
  ctx.restore();
  if (p < 1) { // dust ring
    ctx.strokeStyle = `rgba(255,236,200,${0.7 * (1 - p)})`;
    ctx.lineWidth = 2 / ctx.getTransform().a;
    ctx.beginPath(); ctx.ellipse(o.sx, o.sy, 10 + 26 * p, 5 + 13 * p, 0, 0, 6.283); ctx.stroke();
  }
}

function drawWorld(cam, t, useCache) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintSea(ctx, W, H);
  setCamera(cam);
  const sc = useCache === "before" ? before : after;
  if (useCache) {
    ctx.drawImage(sc.cache, -sc.halfW, -sc.halfH, sc.halfW * 2, sc.halfH * 2);
  } else {
    ctx.drawImage(after.terrain, -after.halfW, -after.halfH, after.halfW * 2, after.halfH * 2);
    for (const o of after.objects) {
      if (!inView(cam, o)) continue;
      const key = revealKey(o), at = key && reveal.get(key);
      if (at === undefined || at === null) { drawObject(ctx, o, o.sx, o.sy); continue; }
      if (t < at) continue;
      drawRising(o, clamp01((t - at) / POP_TIME));
    }
  }
  paintMist(ctx, data, t * 3000, (W + H) / cam.z);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawTags(cam, shot, t) {
  if (shot.type === "arrivals") {
    const placed = [];
    let shown = 0;
    for (const h of shot.handles || []) {
      const o = after.houses.get(h), at = reveal.get("h:" + h);
      if (!o || at === undefined || t < at || shown >= MAX_GLOW_TAGS) continue;
      const [x, y] = screenOf(cam, o.sx, o.sy - 34);
      if (x < 60 || x > W - 60 || y < 520 || y > H - 380) continue;
      if (placed.some(p => Math.abs(p.x - x) < 230 && Math.abs(p.y - y) < 58)) continue;
      placed.push({ x, y });
      shown++;
      drawPill(ctx, "@" + h, x, y, "glow", clamp01((t - at) / 0.3));
    }
  }
  if (shot.type === "landmark" && landmarkTarget && landmarkTarget.by) {
    const at = reveal.get(lotKey(landmarkTarget.gx, landmarkTarget.gy)) ?? shot.start;
    const [x, y] = screenOf(cam, landmarkTarget.sx, landmarkTarget.sy - 95);
    drawPill(ctx, "@" + landmarkTarget.by, x, Math.max(560, y), "glow", clamp01((t - at - 0.2) / 0.3));
  }
}

/** Shrink the title until every line fits without wrapping (down to a floor), then wrap what's left. */
function fitTitle(text) {
  const paras = String(text || "").split("\n");
  let size = TITLE_SIZE;
  const widest = () => Math.max(...paras.map(p => ctx.measureText(p).width));
  ctx.font = `800 ${size}px "Nunito", system-ui, sans-serif`;
  while (size > 54 && widest() > W - 120) {
    size -= 2;
    ctx.font = `800 ${size}px "Nunito", system-ui, sans-serif`;
  }
  return size;
}

function wrap(text) {
  const lines = [];
  for (const para of String(text || "").split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? line + " " + word : word;
      if (ctx.measureText(next).width > W - 120 && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function drawTitle(shot, t) {
  if (!shot.text) return;
  const alpha = Math.min(clamp01((t - shot.start) / 0.35), clamp01((shot.end - t) / 0.25 + (shot === shots.at(-1) ? 1 : 0)));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(20,25,30,.6)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#ffffff";
  const size = fitTitle(shot.text);
  wrap(shot.text).forEach((line, i) => ctx.fillText(line, W / 2, TITLE_Y + i * size * 1.2));
  ctx.restore();
}

function render(t) {
  const shot = shots.find(s => t < s.end) || shots.at(-1);
  const k = clamp01((t - shot.start) / shot.dur);
  const cam = camAt(shot, t);
  const mode = shot.type === "wide" ? "before" : shot.type === "outro" && k > 0.6 ? "after" : null;
  drawWorld(cam, t, mode);
  drawTags(cam, shot, t);
  drawTitle(shot, t);
  if (t < 0.6) { // open on the Mist lifting
    ctx.fillStyle = `rgba(238,241,245,${1 - t / 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ------------------------------------------------------------------ setup
async function applyServerTiers(raw) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return raw;
  const timeout = new Promise(resolve => setTimeout(() => resolve([]), 8000)); // never let the network stall a reel
  const rows = await Promise.race([new OnlineStore(SUPABASE_URL, SUPABASE_KEY, 4).getTiers().catch(() => []), timeout]);
  const built = new Map(rows);
  return { ...raw, residents: raw.residents.map(r => (built.get(r[0]) > r[3] ? [...r.slice(0, 3), built.get(r[0]), ...r.slice(4)] : r)) };
}

async function init(plan) {
  let raw = plan.data;
  if (!raw) {
    const res = await fetch("data.json?v=" + Date.now());
    if (!res.ok) throw new Error("data.json: HTTP " + res.status);
    raw = await res.json();
  }
  data = validateData(await applyServerTiers(raw));
  await document.fonts.load(`800 ${TITLE_SIZE}px Nunito`);
  await document.fonts.load("800 30px Nunito");

  const newHandles = new Set(plan.shots.flatMap(s => (s.type === "arrivals" ? s.allNew || s.handles || [] : [])));
  const landmarkShot = plan.shots.find(s => s.type === "landmark");
  const isShotLandmark = l => Boolean(landmarkShot) && (Number.isInteger(landmarkShot.gx)
    ? l.gx === landmarkShot.gx && l.gy === landmarkShot.gy
    : l.kind === landmarkShot.kind);
  const isNewLandmark = l => Boolean(landmarkShot && landmarkShot.isNew) && isShotLandmark(l);
  const allCells = [...data.residents.map(r => r[1] + "," + r[2]), ...data.landmarks.map(l => l.gx + "," + l.gy)];
  before = buildScene({
    ...data,
    residents: data.residents.filter(r => !newHandles.has(r[0])),
    landmarks: data.landmarks.filter(l => !isNewLandmark(l)),
  }, { occupied: allCells }); // same trees as "after": nothing pops away at the cut
  after = buildScene(data);
  landmarkTarget = landmarkShot
    ? [...after.landmarkList].reverse().find(o => isShotLandmark({ kind: o.type, gx: o.gx, gy: o.gy })) || null
    : null;

  shots = planShots(plan.shots);
  reveal = planReveals(landmarkShot && landmarkShot.isNew ? landmarkTarget : null);
  duration = shots.at(-1).end;
  return { duration, missing: [...newHandles].filter(h => !after.houses.has(h)) };
}

window.film = {
  init,
  frame(t, quality = 0.9) {
    render(t);
    return canvas.toDataURL("image/jpeg", quality);
  },
};
window.filmReady = true;
