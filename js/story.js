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
import { paintSea, paintMist, drawPill } from "./render.js";

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

let scenes = {}, shots = [], reveal = new Map(), duration = 0, lanternTarget = null;
const wishTargets = {};         // scene name -> the landmark that rises in a "wish" shot

// ------------------------------------------------------------------ camera
function fitZ(sceneData) {
  const r = (sceneData.mist_radius + 2) * ISO_K;
  return Math.min(W / (2.05 * r), (H * 0.62) / (1.05 * r));
}

function resolveCam(spec, sceneName) {
  const sc = scenes[sceneName] || scenes.real;
  if (spec.at === "lantern" && lanternTarget) return { x: lanternTarget.sx, y: lanternTarget.sy - 14, z: spec.z ?? 3.5 };
  const wish = wishTargets[sceneName];
  if (spec.at === "wish" && wish) return { x: wish.sx, y: wish.sy - 45, z: spec.z ?? 3 };
  if (spec.at === "house") {
    const o = sc.view.houses.get(spec.handle);
    if (o) return { x: o.sx, y: o.sy - 20, z: spec.z ?? 3.5 };
  }
  if (spec.at === "group") {
    const hs = (spec.handles || []).map(h => sc.view.houses.get(h)).filter(Boolean);
    if (hs.length) {
      const x = hs.reduce((a, o) => a + o.sx, 0) / hs.length, y = hs.reduce((a, o) => a + o.sy, 0) / hs.length;
      return { x, y: y - 20, z: spec.z ?? 2.5 };
    }
  }
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
    if (shot.rise === "new") {
      const list = (shot.handles || []).filter(h => sc.view.houses.has(h));
      // rise once the camera has mostly arrived, one after another
      list.forEach((h, i) => out.set("h:" + h, shot.start + shot.dur * (0.42 + (0.4 * i) / Math.max(1, list.length))));
    }
    const wish = wishTargets[shot.scene];
    if (shot.rise === "wish" && wish) out.set(lotKey(wish), shot.start + shot.dur * 0.3);
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

function mistData(sc, shot, t) {
  if (!shot.creep) return sc.data;
  const k = easeInOut(clamp01((t - shot.start) / shot.dur));
  return { ...sc.data, mist_radius: sc.data.mist_radius - shot.creep * k };
}

function drawIsland(sc, cam, t, shot) {
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
  paintMist(ctx, mistData(sc, shot, t), t * 3000, (W + H) / cam.z);
}

const tagText = o => "@" + o.handle + (o.partner ? " +1" : "");

/** Glowing name tags: new homes as they rise, the wish's owner, or one named house (shot.tag). */
function drawTags(sc, cam, shot, t) {
  const placed = [];
  const put = (text, sx, sy, at) => {
    const [x, y] = screenOf(cam, sx, sy);
    if (x < 80 || x > W - 80 || y < 470 || y > H - 330) return;
    if (placed.some(q => Math.abs(q.x - x) < 300 && Math.abs(q.y - y) < 60)) return;
    placed.push({ x, y });
    drawPill(ctx, text, x, y, "glow", clamp01((t - at) / 0.3));
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shot.rise === "new") {
    for (const h of shot.handles || []) {
      const o = sc.view.houses.get(h), at = reveal.get("h:" + h);
      if (o && at !== undefined && t >= at) put(tagText(o), o.sx, o.sy - 34, at);
    }
  }
  const wish = wishTargets[shot.scene];
  if ((shot.rise === "wish" || shot.wishTag) && wish && wish.by) {
    const at = reveal.get(lotKey(wish)) ?? shot.start;
    if (t >= at) put("@" + wish.by, wish.sx, wish.sy - 100, at + 0.25);
  }
  if (shot.tag) {
    const o = sc.view.houses.get(shot.tag);
    if (o) put(tagText(o), o.sx, o.sy - 34, shot.start + 0.4);
  }
}

/** Pairs of eyes blinking just inside the Mist (night shots), a fixed size on screen so they read. */
function drawEyes(sc, cam, shot, t) {
  if (!shot.eyes) return;
  const r = mistData(sc, shot, t).mist_radius + 0.9;
  const appear = clamp01((t - shot.start - shot.dur * 0.25) / 1.0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < shot.eyes; i++) {
    const a = 0.6 + i * 2.39996;                       // golden-angle spread, same every frame
    const blink = Math.sin(t * 2.1 + i * 1.7) > -0.9 ? 1 : 0.05;
    const rr = r + (i % 3) * 0.8;
    const [ix, iy] = iso(Math.cos(a) * rr, Math.sin(a) * rr);
    const [x, y] = screenOf(cam, ix, iy - 8);
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
    ctx.globalAlpha = appear * blink;
    for (const dx of [-15, 15]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, 22);
      g.addColorStop(0, "rgba(255,245,190,1)"); g.addColorStop(0.25, "rgba(255,200,70,.95)"); g.addColorStop(1, "rgba(255,140,30,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - 22, y - 22, 44, 44);
    }
  }
  ctx.restore();
}

function centerText(text, y, size, weight, color, glow, alpha) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px "Nunito", system-ui, sans-serif`;
  ctx.fillStyle = color; ctx.textAlign = "center";
  ctx.shadowColor = glow; ctx.shadowBlur = 26; ctx.shadowOffsetY = 3;
  wrapLines(text, W - 130).forEach((line, i) => ctx.fillText(line, W / 2, y + i * size * 1.15));
  ctx.restore();
}

function drawHeadline(shot, t) {
  if (shot.headline) centerText(shot.headline, 330, 82, 900, "#ffffff", "rgba(10,12,20,.75)", fade(shot, t, 0.25, 0.3));
}

function drawCard(shot, t) {
  if (!shot.card) return;
  const a = fade(shot, t, 0.5, 0.3);
  centerText(shot.card, H * 0.4, 120, 900, "#fff1d6", "rgba(255,150,60,.95)", a);
  if (shot.cardSub) centerText(shot.cardSub, H * 0.4 + 90, 46, 800, "#fff8ec", "rgba(10,12,20,.8)", a);
}

/** "You decide" card with two choices. */
function drawVote(shot, t) {
  if (!shot.vote) return;
  const a = fade(shot, t, 0.4, 0.3);
  const pop = easeOutBack(clamp01((t - shot.start) / 0.5));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = a;
  const w = W - 140, h = 470, x = 70, y = H * 0.3;
  ctx.translate(W / 2, y + h / 2); ctx.scale(pop, pop); ctx.translate(-W / 2, -(y + h / 2));
  ctx.fillStyle = "rgba(24,20,16,.78)";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 36); ctx.fill();
  ctx.strokeStyle = "rgba(255,206,120,.9)"; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = "#ffd27a"; ctx.textAlign = "center";
  ctx.font = `900 46px "Nunito", system-ui, sans-serif`;
  ctx.fillText("YOU DECIDE", W / 2, y + 80);
  ctx.fillStyle = "#fff8ec"; ctx.font = `800 54px "Nunito", system-ui, sans-serif`;
  wrapLines(shot.vote.q, w - 80).forEach((l, i) => ctx.fillText(l, W / 2, y + 160 + i * 64));
  const bw = (w - 90) / 2;
  [[shot.vote.a, "#c8352f"], [shot.vote.b, "#3d5166"]].forEach(([label, color], i) => {
    const bx = x + 30 + i * (bw + 30), by = y + h - 150;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, 110, 26); ctx.fill();
    ctx.fillStyle = "#fff8ec"; ctx.font = `900 44px "Nunito", system-ui, sans-serif`;
    ctx.fillText(label, bx + bw / 2, by + 70);
  });
  ctx.restore();
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
  drawIsland(sc, cam, t, shot);
  drawLight(sc, cam, shot, t);
  drawEyes(sc, cam, shot, t);
  drawTags(sc, cam, shot, t);
  drawHeadline(shot, t);
  drawCard(shot, t);
  drawVote(shot, t);
  drawLabel(shot, t);
  drawTitleCard(shot, t);
  drawSubtitle(shot, t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const black = Math.max(t < FADE_IN ? 1 - t / FADE_IN : 0,
    shot.fadeOut ? clamp01((t - (shot.end - FADE_OUT)) / FADE_OUT) : 0);
  if (black > 0) { ctx.fillStyle = `rgba(6,8,14,${black})`; ctx.fillRect(0, 0, W, H); }
}

// ------------------------------------------------------------------ setup
function makeScene(raw, opts, risingShots, newHandles = []) {
  const data = validateData(raw);
  const view = buildScene(data, opts);
  const hidden = new Set();
  if (risingShots.includes("houses")) view.houseList.forEach(o => hidden.add("h:" + o.handle));
  newHandles.forEach(h => hidden.add("h:" + h));
  return { data, view, hidden };
}

async function init(plan) {
  await document.fonts.load(`700 ${SUB_SIZE}px Nunito`);
  await document.fonts.load("900 112px Nunito");
  await document.fonts.load("italic 700 44px Nunito");
  await document.fonts.load("900 82px Nunito");
  const rises = name => plan.shots.filter(s => s.scene === name && s.rise).map(s => s.rise);

  const newOnReal = plan.shots.filter(s => s.scene === "real" && s.rise === "new").flatMap(s => s.handles || []);
  scenes = { real: makeScene(plan.data, { plazaLit: plan.plazaLit ?? 2, terrainScale: 6 }, rises("real"), newOnReal) };
  if (plan.newLandmark) { // today's wish on the real island rises in its "wish" shot
    wishTargets.real = scenes.real.view.landmarkList.find(o => o.gx === plan.newLandmark.gx && o.gy === plan.newLandmark.gy) || null;
    if (wishTargets.real && rises("real").includes("wish")) scenes.real.hidden.add(lotKey(wishTargets.real));
  }
  if (plan.glimpse) {
    const g = validateData(plan.glimpse);
    const keepWish = g.landmarks.filter(l => l.kind === plan.wish).slice(0, 1);
    const glimpseRaw = { ...plan.glimpse, landmarks: keepWish.map(l => [l.kind, l.gx, l.gy, l.by, l.day]) };
    scenes.glimpse = makeScene(glimpseRaw, { terrainScale: 4 }, rises("glimpse"));
    wishTargets.glimpse = scenes.glimpse.view.landmarkList[0] || null;
    if (wishTargets.glimpse && rises("glimpse").includes("wish")) scenes.glimpse.hidden.add(lotKey(wishTargets.glimpse));
  }
  lanternTarget = scenes.real.view.objects.find(o => o.kind === "lantern" && o.lit && Math.hypot(o.x, o.y) < 7) || null;

  if (!plan.shots || !plan.shots.length) throw new Error("story has no shots");
  const missing = [];
  for (const [i, s] of plan.shots.entries()) {
    const sc = scenes[s.scene] || scenes.real;
    const need = [s.from, s.to].filter(Boolean);
    if (need.some(c => c.at === "wish") && !wishTargets[s.scene]) missing.push(`shot ${i + 1}: no wish building to show`);
    if (need.some(c => c.at === "lantern") && !lanternTarget) missing.push(`shot ${i + 1}: no lit lantern`);
    const handles = [...need.flatMap(c => c.handle ? [c.handle] : c.handles || []), ...(s.tag ? [s.tag] : []), ...(s.handles || [])];
    for (const h of handles) if (!sc.view.houses.has(h)) missing.push(`shot ${i + 1}: @${h} has no house`);
  }
  if (missing.length) throw new Error("story can't be filmed: " + missing.join("; "));
  shots = planShots(plan.shots);
  reveal = planReveals();
  duration = shots.at(-1).end;
  return { duration, hasWish: Boolean(wishTargets.real || wishTargets.glimpse), hasLantern: Boolean(lanternTarget) };
}

window.story = {
  init,
  frame(t, quality = 0.9) {
    render(t);
    return canvas.toDataURL("image/jpeg", quality);
  },
};
window.storyReady = true;
