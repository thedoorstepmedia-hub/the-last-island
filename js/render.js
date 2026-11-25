// Drawing shared by the interactive map (app.js) and the video recorder (film.js).
import { ISO_K } from "./geo.js";

/** Sea gradient behind the island, in screen px. */
export function paintSea(ctx, vw, vh) {
  const g = ctx.createLinearGradient(0, 0, 0, vh);
  g.addColorStop(0, "#9fd3d6"); g.addColorStop(1, "#5fa9bd");
  ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
}

/**
 * The Mist ring around the cleared land, drawn in iso space (camera transform already set).
 * @param {number} reach how far past the island the fill must go, in iso px (covers every screen edge)
 */
export function paintMist(ctx, data, t, reach) {
  const r0 = data.mist_radius * ISO_K, r1 = (data.mist_radius + 7) * ISO_K;
  ctx.save();
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, r0 * 0.96, 0, 0, r1);
  g.addColorStop(0, "rgba(238,241,245,0)");
  g.addColorStop(0.35, "rgba(238,241,245,.55)");
  g.addColorStop(1, "rgba(238,241,245,.93)");
  ctx.fillStyle = g;
  const far = r1 + reach * 2;
  ctx.fillRect(-far, -far * 2, far * 2, far * 4);
  const N = 30, puff = ISO_K * 4.5;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 6.283 + t * 0.00002 * (i % 2 ? 1 : -1);
    const rr = r0 + ISO_K * (1.5 + 1.5 * Math.sin(t * 0.0003 + i * 1.7));
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    const pg = ctx.createRadialGradient(x, y, 0, x, y, puff);
    pg.addColorStop(0, "rgba(255,255,255,.42)"); pg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = pg; ctx.fillRect(x - puff, y - puff, puff * 2, puff * 2);
  }
  ctx.restore();
}

const PILL_STYLES = {
  small: { weight: 500, size: 11, padX: 10, h: 16, fill: "rgba(43,33,24,.78)", glow: 0 },
  strong: { weight: 600, size: 14, padX: 16, h: 22, fill: "#c8352f", glow: 0 },
  glow: { weight: 800, size: 30, padX: 30, h: 50, fill: "rgba(214,120,40,.92)", glow: 26 },
};

/** Rounded name tag centred at (x, y) = its bottom edge, in screen px. */
export function drawPill(ctx, text, x, y, style = "small", alpha = 1) {
  const s = PILL_STYLES[style] || PILL_STYLES.small;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${s.weight} ${s.size}px "Nunito", system-ui, sans-serif`;
  const w = ctx.measureText(text).width + s.padX, h = s.h;
  if (s.glow) { ctx.shadowColor = "rgba(255,200,110,.95)"; ctx.shadowBlur = s.glow; }
  ctx.fillStyle = s.fill;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h, w, h, h / 2); ctx.fill();
  if (s.glow) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,226,170,.95)"; ctx.lineWidth = 2.5; ctx.stroke();
  }
  ctx.fillStyle = "#fff8ec"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y - h / 2 + 0.5);
  ctx.restore();
}
