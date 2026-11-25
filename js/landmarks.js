// Wish buildings: the things the comments vote for. Each fits one courtyard cell
// (with a little overhang) and is drawn in iso space like the houses in sprites.js.
import { P, poly, box, hipRoof } from "./sprites.js";

const STONE = ["#b9b4a8", "#aaa498", "#8f897e"];
const WOOD = ["#a8794f", "#9a6d46", "#7d5737"];
const DARK_ROOF = ["#26313d", "#3d5166", "#33455a"];
const RED_ROOF = ["#8f2a24", "#c8352f", "#a92f29"];

function steam(ctx, x, y, n = 3) {
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const sx = x + (i - (n - 1) / 2) * 5;
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.bezierCurveTo(sx - 4, y - 5, sx + 4, y - 9, sx, y - 14);
    ctx.stroke();
  }
}

function stall(ctx, bx, by, awning) {
  box(ctx, bx, by, 0.42, 0.3, 6, WOOD);
  const h = 15, s = 0.26, d = 0.2;
  for (const [dx, dy] of [[-s, d], [s, d], [-s, -d], [s, -d]]) {
    const [x, y] = P(dx, dy);
    ctx.fillStyle = "#5a3d28";
    ctx.fillRect(bx + x - 0.8, by + y - h, 1.6, h);
  }
  for (let i = 0; i < 4; i++) {
    const a = -s + (i * 2 * s) / 4, b = a + (2 * s) / 4;
    poly(ctx, bx, by, [P(a, -d - 0.05, h), P(b, -d - 0.05, h), P(b, d + 0.12, h - 5), P(a, d + 0.12, h - 5)],
      i % 2 ? "#fff3e0" : awning);
  }
}

export function drawMarket(ctx, bx, by) {
  const [ax, ay] = P(-0.28, -0.18), [cx, cy] = P(0.3, 0.2);
  stall(ctx, bx + ax, by + ay, "#3a7bd5");
  stall(ctx, bx + cx, by + cy, "#d0392f");
  const [kx, ky] = P(0.38, -0.32);
  box(ctx, bx + kx, by + ky, 0.16, 0.16, 5, ["#d9a75e", "#c99550", "#a77a3f"]);
  ctx.fillStyle = "#e07a2e";
  ctx.beginPath(); ctx.arc(bx + kx, by + ky - 6, 2.2, 0, 6.283); ctx.fill();
}

export function drawHotSpring(ctx, bx, by) {
  poly(ctx, bx, by, [P(-0.55, -0.5), P(0.55, -0.5), P(0.55, 0.5), P(-0.55, 0.5)], "#9a958a");
  poly(ctx, bx, by, [P(-0.45, -0.4), P(0.45, -0.4), P(0.45, 0.4), P(-0.45, 0.4)], "#7fd0d6");
  poly(ctx, bx, by, [P(-0.25, -0.2), P(0.2, -0.2), P(0.2, 0.15), P(-0.25, 0.15)], "#a9e4e6");
  for (const [dx, dy, r] of [[-0.5, 0.45, 3.5], [0.52, -0.3, 3], [0.2, 0.52, 2.6]]) {
    const [x, y] = P(dx, dy);
    ctx.fillStyle = "#8a857a";
    ctx.beginPath(); ctx.ellipse(bx + x, by + y - 1, r * 1.3, r, 0, 0, 6.283); ctx.fill();
  }
  const [tx, ty] = P(-0.45, -0.45);
  box(ctx, bx + tx, by + ty, 0.06, 0.06, 18, WOOD);
  poly(ctx, bx + tx, by + ty - 18, [[-6, 0], [6, 0], [4, 5], [-4, 5]], "#c8352f");
  steam(ctx, bx, by - 3, 3);
}

export function drawRamen(ctx, bx, by) {
  box(ctx, bx, by, 0.62, 0.5, 13, ["#c9a27a", "#b98f66", "#9c7650"]);
  for (let i = 0; i < 3; i++) {
    const a = -0.28 + i * 0.2;
    poly(ctx, bx, by, [P(a, 0.26, 13), P(a + 0.17, 0.26, 13), P(a + 0.17, 0.26, 6), P(a, 0.26, 6)], "#c8352f");
  }
  box(ctx, bx, by, 0.66, 0.14, 5, ["#7d5737", "#6b4a30", "#5a3d28"], -0.01);
  hipRoof(ctx, bx, by, 0.62, 0.5, 13, 9, 0.12, DARK_ROOF, 0.3);
  const [lx, ly] = P(0.36, 0.3, 14);
  ctx.fillStyle = "#e5483e";
  ctx.beginPath(); ctx.ellipse(bx + lx, by + ly, 2.6, 3.6, 0, 0, 6.283); ctx.fill();
  steam(ctx, bx + 4, by - 26, 2);
}

export function drawLighthouse(ctx, bx, by) {
  box(ctx, bx, by, 0.7, 0.7, 5, STONE);
  const bands = ["#f4f1ea", "#c8352f", "#f4f1ea", "#c8352f", "#f4f1ea"];
  bands.forEach((c, i) => {
    const w = 0.42 - i * 0.04;
    box(ctx, bx, by, w, w, 10, [c, c, i % 2 ? "#a92f29" : "#d9d4ca"], -(5 + i * 10));
  });
  const top = 55;
  ctx.fillStyle = "rgba(255,214,120,.95)";
  ctx.fillRect(bx - 4, by - top - 8, 8, 8);
  const g = ctx.createRadialGradient(bx, by - top - 4, 0, bx, by - top - 4, 26);
  g.addColorStop(0, "rgba(255,214,120,.55)"); g.addColorStop(1, "rgba(255,214,120,0)");
  ctx.fillStyle = g; ctx.fillRect(bx - 26, by - top - 30, 52, 52);
  poly(ctx, bx, by, [[-6, -top - 8], [6, -top - 8], [0, -top - 16]], "#3d5166");
}

export function drawWatchtower(ctx, bx, by) {
  const h = 30, s = 0.24;
  for (const [dx, dy] of [[-s, s], [s, s], [-s, -s], [s, -s]]) {
    const [x, y] = P(dx, dy);
    ctx.fillStyle = "#6b4a30";
    ctx.fillRect(bx + x - 1.2, by + y - h, 2.4, h);
  }
  ctx.strokeStyle = "#7d5737"; ctx.lineWidth = 1;
  const [a1, b1] = P(-s, s), [a2, b2] = P(s, s);
  ctx.beginPath();
  ctx.moveTo(bx + a1, by + b1 - 4); ctx.lineTo(bx + a2, by + b2 - h + 4);
  ctx.moveTo(bx + a2, by + b2 - 4); ctx.lineTo(bx + a1, by + b1 - h + 4);
  ctx.stroke();
  box(ctx, bx, by, 0.62, 0.62, 3, WOOD, -h);
  box(ctx, bx, by, 0.6, 0.6, 6, ["#c9a27a", "#b98f66", "#9c7650"], -(h + 3));
  hipRoof(ctx, bx, by, 0.55, 0.55, h + 15, 9, 0.1, ["#9c7a3a", "#d1a955", "#b38b42"], 0.5);
  const [fx, fy] = P(0, 0, h + 24);
  ctx.strokeStyle = "#3b2a1e"; ctx.beginPath(); ctx.moveTo(bx + fx, by + fy); ctx.lineTo(bx + fx, by + fy - 9); ctx.stroke();
  poly(ctx, bx + fx, by + fy - 9, [[0, 0], [7, 2], [0, 5]], "#c8352f");
}

export function drawPagoda(ctx, bx, by) {
  box(ctx, bx, by, 0.8, 0.8, 3, STONE);
  let lift = 3;
  [0.62, 0.5, 0.38].forEach((w, i) => {
    box(ctx, bx, by, w, w, 9, ["#efe6d6", "#ece2cf", "#d4c7ae"], -lift);
    hipRoof(ctx, bx, by, w, w, lift + 9, 6, 0.16, i % 2 ? DARK_ROOF : RED_ROOF, 0.5);
    lift += 15;
  });
  const [sx, sy] = P(0, 0, lift + 2);
  ctx.fillStyle = "#c9a04a";
  ctx.fillRect(bx + sx - 1, by + sy - 12, 2, 12);
}

/** Empty wish lot: a little signpost waiting for the comments to decide. */
export function drawWishSign(ctx, bx, by) {
  ctx.fillStyle = "#6b4a30";
  ctx.fillRect(bx - 1.2, by - 16, 2.4, 16);
  ctx.fillStyle = "#e9d3a6";
  ctx.strokeStyle = "#7d5737";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx - 9, by - 24, 18, 11, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#7d5737";
  ctx.font = "800 9px Nunito, system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("?", bx, by - 18.5);
}

export const LANDMARK_SPRITES = {
  market: drawMarket,
  hot_spring: drawHotSpring,
  ramen: drawRamen,
  lighthouse: drawLighthouse,
  watchtower: drawWatchtower,
  pagoda: drawPagoda,
};

/** Names used in the video voiceover and captions. */
export const LANDMARK_NAMES = {
  market: "a harbour market",
  hot_spring: "a hot spring",
  ramen: "a ramen stall",
  lighthouse: "a lighthouse",
  watchtower: "a watchtower",
  pagoda: "a pagoda",
};
