// Procedural sprites (no image assets). Every draw function works in iso space:
// (bx, by) is the centre of the object's ground cell, in px at zoom 1.
import { TW, TH } from "./geo.js";

export const P = (dx, dy, up = 0) => [(dx - dy) * TW / 2, (dx + dy) * TH / 2 - up];

export function poly(ctx, bx, by, pts, fill, stroke) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(bx + x, by + y) : ctx.moveTo(bx + x, by + y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.6; ctx.stroke(); }
}

/** Box of w×d cells and h px tall; colours = [top, left face, right face]. */
export function box(ctx, bx, by, w, d, h, [top, left, right], lift = 0) {
  const A = P(-w / 2, -d / 2, lift), B = P(w / 2, -d / 2, lift), C = P(w / 2, d / 2, lift), D = P(-w / 2, d / 2, lift);
  const up = ([x, y]) => [x, y - h];
  poly(ctx, bx, by, [D, C, up(C), up(D)], left);
  poly(ctx, bx, by, [C, B, up(B), up(C)], right);
  poly(ctx, bx, by, [up(A), up(B), up(C), up(D)], top);
}

/** Hip roof over a w×d footprint starting at height h; ridge along x. colours = [back, front, side]. */
export function hipRoof(ctx, bx, by, w, d, h, rise, eave, [back, front, side], hip = 0.25) {
  const W = w / 2 + eave, D = d / 2 + eave, r = Math.max(0, W - hip * w);
  const A = P(-W, -D, h), B = P(W, -D, h), C = P(W, D, h), Dd = P(-W, D, h);
  const L = P(-r, 0, h + rise), R = P(r, 0, h + rise);
  poly(ctx, bx, by, [A, B, R, L], back);
  poly(ctx, bx, by, [Dd, A, L], side);
  poly(ctx, bx, by, [Dd, C, R, L], front, "rgba(0,0,0,.18)");
  poly(ctx, bx, by, [C, B, R], side, "rgba(0,0,0,.18)");
}

function flag(ctx, bx, by, color, height) {
  const [x, y] = P(0.32, 0.18);
  ctx.strokeStyle = "#3b2a1e"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(bx + x, by + y); ctx.lineTo(bx + x, by + y - height); ctx.stroke();
  poly(ctx, bx + x, by + y - height, [[0, 0], [7, 2], [0, 5]], color);
}

export function drawTent(ctx, bx, by, clan) {
  const w = 0.7, d = 0.62, rise = 13;
  const C = P(w / 2, d / 2), B = P(w / 2, -d / 2), Dd = P(-w / 2, d / 2), A = P(-w / 2, -d / 2);
  const L = P(-w / 2, 0, rise), R = P(w / 2, 0, rise);
  poly(ctx, bx, by, [A, B, R, L], "#d8ccb0");
  poly(ctx, bx, by, [Dd, C, R, L], "#efe4c8", "rgba(0,0,0,.2)");
  poly(ctx, bx, by, [C, B, R], "#c9b892", "rgba(0,0,0,.2)");
  poly(ctx, bx, by, [P(w / 2, 0.08), P(w / 2, -0.08), P(w / 2, 0, 8)], "#5a4632");
  flag(ctx, bx, by, clan, 18);
}

export function drawHut(ctx, bx, by, clan) {
  box(ctx, bx, by, 0.66, 0.66, 8, ["#c9a27a", "#c09670", "#a57d58"]);
  poly(ctx, bx, by, [P(0.1, 0.33), P(0.3, 0.33), P(0.3, 0.33, 6), P(0.1, 0.33, 6)], clan);
  hipRoof(ctx, bx, by, 0.66, 0.66, 8, 12, 0.1, ["#9c7a3a", "#d1a955", "#b38b42"]);
}

export function drawTownhouse(ctx, bx, by, clan) {
  box(ctx, bx, by, 0.78, 0.74, 15, ["#6b4a35", "#6e4c37", "#56392a"]);
  box(ctx, bx, by, 0.79, 0.75, 4, ["#efe6d6", "#e8dcc6", "#cfc1a8"], -11);
  poly(ctx, bx, by, [P(-0.05, 0.37), P(0.3, 0.37), P(0.3, 0.37, 9), P(-0.05, 0.37, 9)], clan);
  hipRoof(ctx, bx, by, 0.78, 0.74, 15, 10, 0.13, ["#3e4752", "#5d6a78", "#4f5a66"], 0.3);
}

export function drawManor(ctx, bx, by, clan) {
  box(ctx, bx, by, 0.9, 0.86, 13, ["#efe6d6", "#ece2cf", "#d4c7ae"]);
  for (const t of [-0.3, 0, 0.3]) {
    poly(ctx, bx, by, [P(t - 0.02, 0.43), P(t + 0.02, 0.43), P(t + 0.02, 0.43, 13), P(t - 0.02, 0.43, 13)], "#4a3226");
  }
  hipRoof(ctx, bx, by, 0.9, 0.86, 13, 8, 0.14, ["#26313d", "#3d5166", "#33455a"], 0.2);
  box(ctx, bx, by, 0.5, 0.46, 7, ["#efe6d6", "#ece2cf", "#d4c7ae"], -21);
  hipRoof(ctx, bx, by, 0.5, 0.46, 28, 9, 0.12, ["#26313d", "#3d5166", "#33455a"], 0.3);
  flag(ctx, bx, by, clan, 34);
}

export const HOUSES = [drawTent, drawHut, drawTownhouse, drawManor];

export function drawSakura(ctx, bx, by, s = 1) {
  ctx.fillStyle = "#5b3d2e";
  ctx.fillRect(bx - 1.5 * s, by - 12 * s, 3 * s, 12 * s);
  const blob = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(bx + x * s, by + y * s, r * s, 0, 6.283); ctx.fill(); };
  blob(-5, -16, 7, "#f29bb5"); blob(5, -17, 7, "#f29bb5"); blob(0, -22, 8, "#f7b7c9"); blob(-2, -19, 4, "#fbd3df");
}

export function drawPine(ctx, bx, by, s = 1) {
  ctx.fillStyle = "#4a3326";
  ctx.fillRect(bx - 1.2 * s, by - 8 * s, 2.4 * s, 8 * s);
  const tier = (y, w, c) => poly(ctx, bx, by, [[-w * s, y * s], [w * s, y * s], [0, (y - 11) * s]], c);
  tier(-6, 9, "#2f6b4f"); tier(-12, 7.5, "#3f8a63"); tier(-18, 5.5, "#4c9a70");
}

export function drawLantern(ctx, bx, by, lit) {
  ctx.fillStyle = "#8d8f93"; ctx.fillRect(bx - 3, by - 3, 6, 3);
  ctx.fillStyle = "#a3a6ab"; ctx.fillRect(bx - 1.2, by - 9, 2.4, 6);
  ctx.fillStyle = lit ? "#ffd27a" : "#6f7378"; ctx.fillRect(bx - 2.6, by - 14, 5.2, 5);
  poly(ctx, bx, by, [[-4.5, -14], [4.5, -14], [0, -18]], "#7d8085");
}

export function drawGlow(ctx, bx, by, r = 16) {
  const g = ctx.createRadialGradient(bx, by - 11, 0, bx, by - 11, r);
  g.addColorStop(0, "rgba(255,206,110,.55)");
  g.addColorStop(1, "rgba(255,206,110,0)");
  ctx.fillStyle = g;
  ctx.fillRect(bx - r, by - 11 - r, r * 2, r * 2);
}

export function drawShrine(ctx, bx, by) {
  box(ctx, bx, by, 3.2, 2.4, 24, ["#efe6d6", "#f2e8d8", "#d9ccb4"]);
  for (const t of [-1.4, -0.7, 0, 0.7, 1.4]) {
    poly(ctx, bx, by, [P(t - 0.07, 1.2), P(t + 0.07, 1.2), P(t + 0.07, 1.2, 24), P(t - 0.07, 1.2, 24)], "#c8352f");
  }
  hipRoof(ctx, bx, by, 3.2, 2.4, 24, 22, 0.45, ["#232a33", "#3a4552", "#2f3843"], 0.18);
  const [gx, gy] = P(0, 0, 50);
  ctx.fillStyle = "#c9a04a"; ctx.fillRect(bx + gx - 2, by + gy - 4, 4, 6);
}

export function drawTorii(ctx, bx, by) {
  const red = "#d0392f", dark = "#2b2b2b";
  ctx.fillStyle = red;
  ctx.fillRect(bx - 17, by - 34, 4, 34);
  ctx.fillRect(bx + 13, by - 34, 4, 34);
  ctx.fillRect(bx - 21, by - 28, 42, 3.5);
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(bx - 27, by - 39); ctx.quadraticCurveTo(bx, by - 35, bx + 27, by - 39);
  ctx.lineTo(bx + 25, by - 35); ctx.quadraticCurveTo(bx, by - 31.5, bx - 25, by - 35);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = red; ctx.fillRect(bx - 22, by - 34, 44, 3);
}
