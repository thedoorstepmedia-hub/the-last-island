// Story mode: scripted reels (e.g. the Day 1 "Lantern Keeper" intro) for tools/make_story.py.
// Deterministic like film.js: frame(t) always draws the same picture for the same plan and time.
//
//   await story.init(plan)   -> { duration }
//   story.frame(t, quality)  -> JPEG data URL
//
// plan = {
//   data,                 the real island (validated data.json)
//   glimpse?,             a future island for "a glimpse of what may come" shots
//   wish?,                landmark kind that rises in a shot with rise: "wish" (glimpse island)
//   plazaLit?,            plaza lanterns lit on the real island (default 2)
//   shots: [{ dur, scene: "real"|"glimpse", from?, to, light?: [a, b], subtitle?, label?,
//             title?, rise?: "houses"|"wish", fadeOut? }]
// }
// Camera spec: { at: "lantern"|"center"|"wish", z?, fit? } (fit = multiple of the whole-island zoom).
import { iso, ISO_K } from "./geo.js";
import { buildScene, drawObject } from "./scene.js";
import { drawGlow } from "./sprites.js";
import { validateData } from "./data.js";
import { paintSea, paintMist } from "./render.js";

const canvas = document.getElementById("film");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;
const CENTER = (() => { const [x, y] = iso(0, 0); return { x, y: y + 10 }; })();
const POP_TIME = 0.5;
const SUB_Y = H * 0.63, SUB_SIZE = 46, LABEL_Y = 300, TITLE_Y = H * 0.3;
const FADE_IN = 1.2, FADE_OUT = 1.6;

const LIGHTS = {            // multiply tints over the island
  dawn: { color: "#ffc9a3", a: 0.42, glow: 0.35 },
  day: { color: "#ffffff", a: 0, glow: 0 },
  dusk: { color: "#ff9a66", a: 0.5, glow: 0.6 },
  night: { color: "#141a40", a: 0.84, glow: 1 },
};

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpCam = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)) });

let scenes = {}, shots = [], reveal = new Map(), duration = 0, wishTarget = null, lanternTarget = null;

// ------------------------------------------------------------------ camera
function fitZ(sceneData) {
  const r = (sceneData.mist_radius + 2) * ISO_K;
  return Math.min(W / (2.05 * r), (H * 0.62) / (1.05 * r));
}

function resolveCam(spec, sceneName) {
  const sc = scenes[sceneName] || scenes.real;
  if (spec.at === "lantern" && lanternTarget) return { x: lanternTarget.sx, y: lanternTarget.sy - 14, z: spec.z ?? 3.5 };
  if (spec.at === "wish" && wishTarget) return { x: wishTarget.sx, y: wishTarget.sy - 45, z: spec.z ?? 3 };
  return { ...CENTER, z: spec.z ?? fitZ(sc.data) * (spec.fit ?? 1.3) };
}

function planShots(raw) {
  let t = 0, prev = null;
  return raw.map(s => {
    const from = s.from ? resolveCam(s.from, s.scene) : prev || resolveCam(s.to, s.scene);
    const to = resolveCam(s.to, s.scene);
    const shot = { ...s, start: t, end: t + s.dur, from, to };
    t = shot.end;
    prev = to;
    return shot;
  });
}

const lotKey = o => "l:" + o.gx + "," + o.gy;

function planReveals() {
  const out = new Map();
  for (const shot of shots) {
    const sc = scenes[shot.scene];
    if (!sc) continue;
    if (shot.rise === "houses") {
      const houses = [...sc.view.houseList].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
      houses.forEach((o, i) => {
        if (!out.has("h:" + o.handle)) out.set("h:" + o.handle, shot.start + shot.dur * (0.06 + (0.78 * i) / houses.length));
      });
    }
    if (shot.rise === "wish" && wishTarget) out.set(lotKey(wishTarget), shot.start + shot.dur * 0.35);
  }
  // Houses on a scene that has a "houses" shot stay hidden until it; the wish stays hidden until its shot.
  return out;
}

// ------------------------------------------------------------------ drawing
function screenOf(cam, sx, sy) { return [(sx - cam.x) * cam.z + W / 2, (sy - cam.y) * cam.z + H / 2]; }

function inView(cam, o) {
  const [x, y] = screenOf(cam, o.sx, o.sy);
  return x > -260 && x < W + 260 && y > -120 && y < H + 500;
}

function drawRising(o, p) {
  ctx.save();
  ctx.translate(o.sx, o.sy);
  ctx.scale(1, Math.max(0.01, easeOutBack(p)));
  drawObject(ctx, o, 0, 0);
  ctx.restore();
}

function revealKey(o) {
  if (o.kind === "house") return "h:" + o.handle;
  if (o.kind === "landmark") return lotKey(o);
  return null;
}

function drawIsland(sc, cam, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintSea(ctx, W, H);
  ctx.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
  ctx.drawImage(sc.view.terrain, -sc.view.halfW, -sc.view.halfH, sc.view.halfW * 2, sc.view.halfH * 2);
  for (const o of sc.view.objects) {
    if (!inView(cam, o)) continue;
    const key = revealKey(o), at = key && sc.hidden.has(key) ? reveal.get(key) : undefined;
    if (key && sc.hidden.has(key) && (at === undefined || t < at)) continue;
    if (at !== undefined) drawRising(o, clamp01((t - at) / POP_TIME));
    else drawObject(ctx, o, o.sx, o.sy);
  }
  paintMist(ctx, sc.data, t * 3000, (W + H) / cam.z);
}

function lightAt(shot, t) {
  const [a, b] = shot.light || ["day", "day"];
  return { a: LIGHTS[a] || LIGHTS.day, b: LIGHTS[b] || LIGHTS.day, k: easeInOut(clamp01((t - shot.start) / shot.dur)) };
}

function drawLight(sc, cam, shot, t) {
  const { a, b, k } = lightAt(shot, t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (const [l, w] of [[a, 1 - k], [b, k]]) {
    if (!l.a || !w) continue;
    ctx.globalAlpha = l.a * w;
    ctx.fillStyle = l.color;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  const glow = lerp(a.glow, b.glow, k);
  if (glow <= 0) return;
  ctx.save(); // lit lanterns shine through the dark
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = glow;
  ctx.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
  for (const o of sc.view.objects) {
    if (o.kind === "lantern" && o.lit && inView(cam, o)) drawGlow(ctx, o.sx, o.sy, 40);
  }
  ctx.restore();
}

function fade(shot, t, inDur = 0.4, outDur = 0.3) {
  const last = shot === shots.at(-1);
  return Math.min(clamp01((t - shot.start) / inDur), last ? 1 : clamp01((shot.end - t) / outDur));
}

function wrapLines(text, maxWidth) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? line + " " + word : word;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function drawSubtitle(shot, t) {
  if (!shot.subtitle) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = fade(shot, t, 0.35, 0.25);
  ctx.font = `700 ${SUB_SIZE}px "Nunito", system-ui, sans-serif`;
  const lines = wrapLines(shot.subtitle, W - 220);
  const lh = SUB_SIZE * 1.28, h = lines.length * lh + 34;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 60;
  ctx.fillStyle = "rgba(24,20,16,.52)";
  ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, SUB_Y - h / 2, w, h, 20); ctx.fill();
  ctx.fillStyle = "#fff8ec"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, SUB_Y - h / 2 + 17 + lh * (i + 0.5)));
  ctx.restore();
}

function drawLabel(shot, t) {
  if (!shot.label) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = fade(shot, t, 0.6, 0.3);
  ctx.font = `italic 700 44px "Nunito", system-ui, sans-serif`;
  const w = ctx.measureText(shot.label).width + 56;
  ctx.fillStyle = "rgba(24,20,16,.45)";
  ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, LABEL_Y - 44, w, 64, 32); ctx.fill();
  ctx.fillStyle = "#fff8ec"; ctx.textAlign = "center";
  ctx.fillText(shot.label, W / 2, LABEL_Y);
  ctx.restore();
}

function drawTitleCard(shot, t) {
  if (!shot.title) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp01((t - shot.start - 0.3) / 1.0);
  ctx.font = `900 112px "Nunito", system-ui, sans-serif`;
  ctx.fillStyle = "#fff3dc"; ctx.textAlign = "center";
  ctx.shadowColor = "rgba(255,190,100,.85)"; ctx.shadowBlur = 40;
  ctx.fillText(shot.title, W / 2, TITLE_Y);
  ctx.restore();
}

function render(t) {
  const shot = shots.find(s => t < s.end) || shots.at(-1);
  const sc = scenes[shot.scene] || scenes.real;
  const cam = lerpCam(shot.from, shot.to, easeInOut(clamp01((t - shot.start) / shot.dur)));
  drawIsland(sc, cam, t);
  drawLight(sc, cam, shot, t);
  drawLabel(shot, t);
  drawTitleCard(shot, t);
  drawSubtitle(shot, t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const black = Math.max(t < FADE_IN ? 1 - t / FADE_IN : 0,
    shot.fadeOut ? clamp01((t - (shot.end - FADE_OUT)) / FADE_OUT) : 0);
  if (black > 0) { ctx.fillStyle = `rgba(6,8,14,${black})`; ctx.fillRect(0, 0, W, H); }
}

// ------------------------------------------------------------------ setup
function makeScene(raw, opts, risingShots) {
  const data = validateData(raw);
  const view = buildScene(data, opts);
  const hidden = new Set();
  if (risingShots.includes("houses")) view.houseList.forEach(o => hidden.add("h:" + o.handle));
  return { data, view, hidden };
}

async function init(plan) {
  await document.fonts.load(`700 ${SUB_SIZE}px Nunito`);
  await document.fonts.load("900 112px Nunito");
  await document.fonts.load("italic 700 44px Nunito");
  const rises = name => plan.shots.filter(s => s.scene === name && s.rise).map(s => s.rise);

  scenes = { real: makeScene(plan.data, { plazaLit: plan.plazaLit ?? 2, terrainScale: 6 }, rises("real")) };
  if (plan.glimpse) {
    const g = validateData(plan.glimpse);
    const keepWish = g.landmarks.filter(l => l.kind === plan.wish).slice(0, 1);
    const glimpseRaw = { ...plan.glimpse, landmarks: keepWish.map(l => [l.kind, l.gx, l.gy, l.by, l.day]) };
    scenes.glimpse = makeScene(glimpseRaw, { terrainScale: 4 }, rises("glimpse"));
    wishTarget = scenes.glimpse.view.landmarkList[0] || null;
    if (wishTarget && rises("glimpse").includes("wish")) scenes.glimpse.hidden.add(lotKey(wishTarget));
  }
  lanternTarget = scenes.real.view.objects.find(o => o.kind === "lantern" && o.lit && Math.hypot(o.x, o.y) < 7) || null;

  shots = planShots(plan.shots);
  reveal = planReveals();
  duration = shots.at(-1).end;
  return { duration, hasWish: Boolean(wishTarget), hasLantern: Boolean(lanternTarget) };
}

window.story = {
  init,
  frame(t, quality = 0.9) {
    render(t);
    return canvas.toDataURL("image/jpeg", quality);
  },
};
window.storyReady = true;
