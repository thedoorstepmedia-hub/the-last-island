// Shared geometry + deterministic randomness for the island map.
// World units are grid cells; iso space is pixels at zoom 1.

export const TW = 32;           // diamond width of one cell (px at zoom 1)
export const TH = 16;           // diamond height of one cell
export const ISO_K = Math.SQRT2 * TW / 2; // world radius -> iso horizontal radius

export const CLAN_COLORS = ["#e07a2e", "#6b8e4e", "#c8334a", "#3a7bd5"]; // Fox, Bear, Crane, Koi

export function iso(x, y) {
  return [(x - y) * TW / 2, (x + y) * TH / 2];
}

export function fromIso(sx, sy) {
  const a = sx / (TW / 2), b = sy / (TH / 2);
  return [(a + b) / 2, (b - a) / 2];
}

// Integer cell hash -> [0, 1)
export function cellHash(x, y, salt = 0) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// String hash (FNV-1a) -> [0, 1)
export function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// Smooth value noise in [0, 1)
export function noise(x, y, salt = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = t => t * t * (3 - 2 * t);
  const a = cellHash(xi, yi, salt), b = cellHash(xi + 1, yi, salt);
  const c = cellHash(xi, yi + 1, salt), d = cellHash(xi + 1, yi + 1, salt);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Coastline distance from the centre at angle theta.
export function shoreAt(theta, islandRadius) {
  return islandRadius + 3 * Math.sin(3 * theta + 1) + 2 * Math.sin(5 * theta + 2)
    + 1.5 * Math.sin(9 * theta + 0.5);
}

export function isRoad(x, y, block) {
  return x % block === 0 || y % block === 0;
}

export function isCourtyard(x, y, block) {
  const m = block >> 1, mod = v => ((v % block) + block) % block;
  return mod(x) === m && mod(y) === m;
}

export function normalizeHandle(raw) {
  const h = String(raw || "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
}
