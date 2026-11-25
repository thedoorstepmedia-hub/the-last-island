// Validates data.json before anything is drawn: one bad row must never blank the map.
import { normalizeHandle, CLAN_COLORS, isCourtyard, isWishLot } from "./geo.js";
import { LANDMARK_SPRITES } from "./landmarks.js";

const HOUSE_TIERS = 4; // sprites.js HOUSES length

const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = v => (typeof v === "string" ? v : "");
const strList = (v, fallback) =>
  Array.isArray(v) && v.length && v.every(s => typeof s === "string") ? [...v] : fallback;

/**
 * @param {unknown} raw parsed data.json
 * @returns {object} a new, safe data object (input is not modified)
 * @throws {Error} when the file is not a world at all
 */
export function validateData(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.residents)) {
    throw new Error("data.json has no residents list");
  }
  const jobs = strList(raw.jobs, ["Settler"]);
  const clans = strList(raw.clans, ["Fox", "Bear", "Crane", "Koi"]).slice(0, CLAN_COLORS.length);
  const tiers = strList(raw.tiers, ["Tent", "Thatched hut", "Townhouse", "Manor"]);
  const maxTier = Math.min(HOUSE_TIERS, tiers.length) - 1;

  const seen = new Set();
  const residents = [];
  for (const row of raw.residents) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [rawHandle, gx, gy, tier, job, clan] = row;
    const handle = normalizeHandle(rawHandle);
    if (!handle || handle !== rawHandle || seen.has(handle)) continue;
    if (!Number.isInteger(gx) || !Number.isInteger(gy)) continue;
    if (!Number.isInteger(tier) || tier < 0 || tier > maxTier) continue;
    if (!Number.isInteger(job) || job < 0 || job >= jobs.length) continue;
    if (!Number.isInteger(clan) || clan < 0 || clan >= clans.length) continue;
    seen.add(handle);
    residents.push([handle, gx, gy, tier, job, clan]);
  }

  const block = Math.max(2, Math.round(num(raw.block, 4)));
  const plazaRadius = Math.max(2, num(raw.plaza_radius, 7));
  const landmarks = cleanLandmarks(raw.landmarks, block, plazaRadius);

  const clanCounts = clans.map((_, i) => residents.filter(r => r[5] === i).length);
  const furthest = [...residents, ...landmarks.map(l => [l.kind, l.gx, l.gy])]
    .reduce((m, r) => Math.max(m, Math.hypot(r[1], r[2])), 0);
  const mist = Math.max(num(raw.mist_radius, 0), furthest + 1, 10);

  return {
    name: str(raw.name) || "The Last Island",
    day: Math.max(1, Math.round(num(raw.day, 1))),
    settlers: residents.length,
    goal_title: str(raw.goal_title),
    lanterns_lit: Math.max(0, Math.round(num(raw.lanterns_lit, 0))),
    lantern_goal: Math.max(1, Math.round(num(raw.lantern_goal, 1))),
    wish: str(raw.wish),
    vote: str(raw.vote),
    wish_by: normalizeHandle(raw.wish_by) || "",
    block,
    plaza_radius: plazaRadius,
    mist_radius: mist,
    island_radius: Math.max(num(raw.island_radius, 0), mist + 4),
    jobs, clans, tiers,
    clan_counts: clanCounts,
    residents,
    landmarks,
  };
}

/** [[kind, gx, gy, by, day], ...] -> [{ kind, gx, gy, by, day }]; unknown kinds and clashes are skipped. */
function cleanLandmarks(raw, block, plazaRadius) {
  if (!Array.isArray(raw)) return [];
  const taken = new Set();
  const out = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [kind, gx, gy, by, day] = row;
    if (!Object.prototype.hasOwnProperty.call(LANDMARK_SPRITES, kind) || !Number.isInteger(gx) || !Number.isInteger(gy)) continue;
    if (!isCourtyard(gx, gy, block) || !isWishLot(gx, gy, block, plazaRadius) || taken.has(gx + "," + gy)) continue;
    taken.add(gx + "," + gy);
    out.push({ kind, gx, gy, by: normalizeHandle(by) || "", day: Number.isInteger(day) ? day : 1 });
  }
  return out;
}
