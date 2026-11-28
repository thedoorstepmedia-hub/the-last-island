// The Last Island — game rules. "coins" are shown to players as Embers 🔥. Pure functions only (no DOM, no storage) so the exact
// same rules can later run on the server, where they must be enforced to stop cheating.
//
// Every action returns { ok, player, message, ...extra } and never mutates its input.

export const ENERGY_PER_DAY = 10;
export const START_COINS = 50;
export const LANTERN_COST = 5;      // resources per lantern donated to the island
export const SELL_PRICE = 1;        // coins received per resource sold at the harbour
export const BUY_PRICE = 2;         // coins paid per resource bought at the harbour
export const RESOURCES = ["wood", "stone", "food"];

/** What one unit of energy produces for each job (every job also earns +1 coin). */
export const JOB_YIELDS = {
  "Rice Farmer": { food: 3 },
  "Fisher": { food: 3 },
  "Woodcutter": { wood: 3 },
  "Stonemason": { stone: 3 },
  "Carpenter": { wood: 1, stone: 1, coins: 1 },
  "Shrine Keeper": { coins: 3 },
};
export const JOBS = Object.keys(JOB_YIELDS);

/** Cost to go from tier i to tier i+1: Tent -> Thatched hut -> Townhouse -> Manor. */
const UPGRADE_COSTS = [
  { wood: 15 },
  { wood: 40, stone: 25 },
  { wood: 90, stone: 70, coins: 60 },
];
export const MAX_TIER = UPGRADE_COSTS.length;

const fail = (player, message) => ({ ok: false, player, message });
const isCount = n => Number.isInteger(n) && n > 0;

/**
 * @param {string} handle
 * @param {string} job one of JOBS (falls back to Fisher)
 * @param {string} today "YYYY-MM-DD"
 * @param {number} [tier] starting house tier
 */
export function newPlayer(handle, job, today, tier = 0) {
  return {
    handle,
    job: JOB_YIELDS[job] ? job : "Fisher",
    day: today,
    energy: ENERGY_PER_DAY,
    coins: START_COINS,
    wood: 0, stone: 0, food: 0,
    tier: Math.max(0, Math.min(MAX_TIER, tier | 0)),
    lanterns: 0,
  };
}

/** Full energy again on a new day. */
export function refill(player, today) {
  return player.day === today ? player : { ...player, day: today, energy: ENERGY_PER_DAY };
}

export function work(player) {
  if (player.energy < 1) return fail(player, "No energy left. It refills tomorrow.");
  const gained = { ...JOB_YIELDS[player.job] };
  gained.coins = (gained.coins || 0) + 1;
  const next = { ...player, energy: player.energy - 1 };
  for (const [k, v] of Object.entries(gained)) next[k] = (next[k] || 0) + v;
  return { ok: true, player: next, gained, message: "" };
}

export function upgradeCost(tier) {
  return tier >= 0 && tier < MAX_TIER ? { ...UPGRADE_COSTS[tier] } : null;
}

export function upgrade(player) {
  const cost = upgradeCost(player.tier);
  if (!cost) return fail(player, "Your manor is already the finest on the island.");
  const missing = Object.entries(cost).filter(([k, v]) => (player[k] || 0) < v);
  if (missing.length) {
    return fail(player, "Not enough " + missing.map(([k, v]) => `${k === "coins" ? "Embers" : k} (${player[k] || 0}/${v})`).join(", "));
  }
  const next = { ...player, tier: player.tier + 1 };
  for (const [k, v] of Object.entries(cost)) next[k] -= v;
  return { ok: true, player: next, message: "" };
}

/** Harbour trade with the island (not between players yet). side: "sell" | "buy". */
export function trade(player, side, resource, qty) {
  if (!RESOURCES.includes(resource)) return fail(player, "The harbour doesn't trade that.");
  if (!isCount(qty)) return fail(player, "Pick an amount.");
  if (side === "sell") {
    if (player[resource] < qty) return fail(player, `You only have ${player[resource]} ${resource}.`);
    return { ok: true, player: { ...player, [resource]: player[resource] - qty, coins: player.coins + qty * SELL_PRICE }, message: "" };
  }
  if (side === "buy") {
    const price = qty * BUY_PRICE;
    if (player.coins < price) return fail(player, `That costs ${price} Embers. You have ${player.coins}.`);
    return { ok: true, player: { ...player, [resource]: player[resource] + qty, coins: player.coins - price }, message: "" };
  }
  return fail(player, "Buy or sell?");
}

/** Donate resources to light lanterns (whole lanterns only; the remainder stays). */
export function donate(player, resource, qty) {
  if (!RESOURCES.includes(resource)) return fail(player, "Lanterns need wood, stone or food.");
  const usable = Math.min(Number.isInteger(qty) ? qty : 0, player[resource]);
  const lanterns = Math.floor(usable / LANTERN_COST);
  if (lanterns < 1) return fail(player, `One lantern takes ${LANTERN_COST} ${resource}.`);
  const spent = lanterns * LANTERN_COST;
  return {
    ok: true,
    player: { ...player, [resource]: player[resource] - spent, lanterns: player.lanterns + lanterns },
    lanterns,
    message: "",
  };
}
