// Builds the island once from data.json: a cached bitmap (terrain + every object)
// plus a depth-sorted object list for crisp live drawing when zoomed in.
import { iso, ISO_K, TW, TH, CLAN_COLORS, cellHash, noise, shoreAt, isRoad, isCourtyard, strHash } from "./geo.js";
import { HOUSES, drawSakura, drawPine, drawLantern, drawGlow, drawShrine, drawTorii } from "./sprites.js";

const GRASS = ["#8fbd70", "#97c277", "#a0c87f", "#a9cd86"];
const WILD = ["#7aa564", "#80aa68", "#86af6d"];
const MAX_CACHE_PX = 4096;

const PLAZA = [
  { kind: "shrine", x: -2.5, y: -2.5 },
  { kind: "sakura", x: -4.5, y: 2.5, s: 1.5 },
  { kind: "sakura", x: 2.5, y: -4.5, s: 1.5 },
  { kind: "lantern", x: 3, y: 5, lit: true },
  { kind: "lantern", x: 5, y: 3, lit: true },
  { kind: "torii", x: 4.6, y: 4.6 },
];

function landColor(x, y, r, mist, data) {
  if (r <= data.plaza_radius) return (x + y) % 2 ? "#d9d2c3" : "#d2cab9";
  if (r <= mist + 1 && isRoad(x, y, data.block)) return "#d8c08f";
  if (r <= mist && isCourtyard(x, y, data.block)) return "#b5d58e";
  const n = noise(x / 6, y / 6, 3);
  return r <= mist ? GRASS[Math.min(3, Math.floor(n * 4))] : WILD[Math.min(2, Math.floor(n * 3))];
}

function cellColor(x, y, data) {
  const r = Math.hypot(x, y), shore = shoreAt(Math.atan2(y, x), data.island_radius);
  if (r > shore + 3) return null;
  if (r > shore) return "#86cdcc";
  if (r > shore - 1.5) return "#ecd9a6";
  return landColor(x, y, r, data.mist_radius, data);
}

function diamond(ctx, x, y, color) {
  const [sx, sy] = iso(x, y);
  ctx.beginPath();
  ctx.moveTo(sx, sy - TH / 2); ctx.lineTo(sx + TW / 2, sy);
  ctx.lineTo(sx, sy + TH / 2); ctx.lineTo(sx - TW / 2, sy);
  ctx.closePath();
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.fill(); ctx.stroke(); // stroke hides hairline seams between cells
}

function scatter(data, occupied, extent) {
  const objects = [], lanternSpots = [];
  for (let x = -extent; x <= extent; x++) {
    for (let y = -extent; y <= extent; y++) {
      const r = Math.hypot(x, y);
      if (r <= data.plaza_radius + 0.5 || occupied.has(x + "," + y)) continue;
      const shore = shoreAt(Math.atan2(y, x), data.island_radius);
      if (r > shore - 2) continue;
      const inside = r <= data.mist_radius;
      if (inside && isRoad(x, y, data.block)) {
        if (cellHash(x, y, 9) < 0.3) lanternSpots.push({ x, y, r });
        continue;
      }
      const h = cellHash(x, y, 5);
      const garden = inside && isCourtyard(x, y, data.block);
      if (garden || h < (inside ? 0.16 : 0.5)) {
        const kind = cellHash(x, y, 6) < (garden ? 0.7 : inside ? 0.45 : 0.15) ? "sakura" : "pine";
        objects.push({ kind, x: x + (h - 0.25) * 0.6, y, s: 0.8 + cellHash(x, y, 7) * 0.4 });
      }
    }
  }
  lanternSpots.sort((a, b) => a.r - b.r)
    .forEach((p, i) => objects.push({ kind: "lantern", x: p.x, y: p.y, lit: i < data.lanterns_lit }));
  return objects;
}

export function drawObject(ctx, o, bx, by) {
  switch (o.kind) {
    case "house": return HOUSES[o.tier](ctx, bx, by, CLAN_COLORS[o.clan]);
    case "sakura": return drawSakura(ctx, bx, by, o.s);
    case "pine": return drawPine(ctx, bx, by, o.s);
    case "lantern": if (o.lit) drawGlow(ctx, bx, by); return drawLantern(ctx, bx, by, o.lit);
    case "shrine": return drawShrine(ctx, bx, by);
    case "torii": return drawTorii(ctx, bx, by);
    default: return undefined;
  }
}

/** @param {object} data parsed data.json */
export function buildScene(data) {
  const occupied = new Set(data.residents.map(([, gx, gy]) => gx + "," + gy));
  const houseObjects = data.residents.map(([handle, gx, gy, tier, job, clan]) => ({
    kind: "house", handle, x: gx + (strHash(handle) - 0.5) * 0.12, y: gy, gx, gy, tier, job, clan,
  }));

  const extent = Math.ceil(data.island_radius + 7);
  const objects = [...houseObjects, ...PLAZA, ...scatter(data, occupied, extent)]
    .map(o => { const [sx, sy] = iso(o.x, o.y); return { ...o, sx, sy, depth: o.x + o.y }; })
    .sort((a, b) => a.depth - b.depth);

  const halfW = extent * ISO_K + 40, halfH = extent * ISO_K / 2 + 70;
  const scale = Math.min(2, MAX_CACHE_PX / (2 * halfW), MAX_CACHE_PX / (2 * halfH));
  const drawTerrain = ctx => {
    ctx.lineWidth = 0.8;
    for (let x = -extent; x <= extent; x++) {
      for (let y = -extent; y <= extent; y++) {
        const color = cellColor(x, y, data);
        if (color) diamond(ctx, x, y, color);
      }
    }
  };
  // Full bitmap (terrain + objects) for zoomed-out views.
  const cache = makeLayer(halfW, halfH, scale, ctx => {
    drawTerrain(ctx);
    for (const o of objects) drawObject(ctx, o, o.sx, o.sy);
  });
  // Terrain-only bitmap for zoomed-in views, where objects are drawn live (no blurry double copy).
  const terrainScale = scale / 2;
  const terrain = makeLayer(halfW, halfH, terrainScale, drawTerrain);

  // Lookups point at the final objects (with screen positions), not the pre-map copies.
  const houseList = objects.filter(o => o.kind === "house");
  const houses = new Map(houseList.map(o => [o.handle, o]));
  return { cache, terrain, scale, terrainScale, halfW, halfH, objects, houseList, houses };
}

function makeLayer(halfW, halfH, scale, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(2 * halfW * scale);
  canvas.height = Math.ceil(2 * halfH * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, halfW * scale, halfH * scale);
  paint(ctx);
  return canvas;
}
