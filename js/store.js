// Save systems. The game (play.js) only talks to this interface:
//
//   mode                                  "device" | "online"
//   needsSignIn(handle)               ->  boolean
//   signIn(handle, code)              ->  Promise<{ ok, message }>
//   load(handle, start)               ->  Promise<{ ok, player, message, fresh? }>
//   perform(handle, action, res, qty) ->  Promise<{ ok, player, message, gained?, lanterns?, signedOut? }>
//   getIsland()                       ->  Promise<{ lanterns, byClan }>   lanterns lit in play
//   getTiers()                        ->  Promise<[handle, tier][]>       houses built in play
//   getEmbers()                       ->  Promise<[handle, embers][]>     richest first ([] offline)
//
// action: "work" | "upgrade" | "buy" | "sell" | "donate".
// DeviceStore runs economy.js in this browser (offline demo). OnlineStore asks the server,
// which re-checks every rule (supabase/schema.sql), so the browser can't cheat.
import { newPlayer, refill, work, upgrade, trade, donate } from "./economy.js";

const PREFIX = "tli:";
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private mode, blocked storage or corrupt value: behave as empty
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key) {
  try { window.localStorage.removeItem(PREFIX + key); } catch { /* storage blocked: nothing to remove */ }
}

const emptyIsland = clans => ({ lanterns: 0, byClan: new Array(clans).fill(0) });

function cleanIsland(raw, clans) {
  const base = emptyIsland(clans);
  if (!raw || !Array.isArray(raw.byClan)) return base;
  return {
    lanterns: Number.isInteger(raw.lanterns) ? raw.lanterns : 0,
    byClan: base.byClan.map((_, i) => (Number.isInteger(raw.byClan[i]) ? raw.byClan[i] : 0)),
  };
}

/** Pure: apply one action with the shared rules. */
export function applyAction(player, action, resource, qty) {
  switch (action) {
    case "work": return work(player);
    case "upgrade": return upgrade(player);
    case "buy": case "sell": return trade(player, action, resource, qty);
    case "donate": return donate(player, resource, qty);
    default: return { ok: false, player, message: "Unknown action." };
  }
}

// ------------------------------------------------------------------ offline demo
export class DeviceStore {
  /** @param {number} clanCount */
  constructor(clanCount) {
    this.mode = "device";
    this.clanCount = clanCount;
  }

  needsSignIn() { return false; }

  async signIn() { return { ok: true, message: "" }; }

  /** @param {{ job: string, tier: number, clan: number }} start used for a brand-new player */
  async load(handle, start) {
    const saved = readJson("player:" + handle);
    const valid = saved && saved.handle === handle ? saved : null;
    const player = refill(valid || newPlayer(handle, start.job, today(), start.tier), today());
    this._save(player);
    const refilled = Boolean(valid) && player.energy > valid.energy;
    return { ok: true, player, fresh: !valid, message: refilled ? "New day: energy refilled." : "" };
  }

  async perform(handle, action, resource, qty) {
    const { player } = await this.load(handle, { job: "", tier: 0, clan: 0 });
    const result = applyAction(player, action, resource, qty);
    if (!result.ok) return result;
    this._save(result.player);
    if (action === "donate") {
      const clan = readJson("clan:" + handle) ?? 0;
      const island = await this.getIsland();
      writeJson("island", {
        lanterns: island.lanterns + result.lanterns,
        byClan: island.byClan.map((v, i) => (i === clan ? v + result.lanterns : v)),
      });
    }
    return result;
  }

  /** The device demo has no server, so remember which clan a handle belongs to. */
  rememberClan(handle, clan) { writeJson("clan:" + handle, clan); }

  async getIsland() { return cleanIsland(readJson("island"), this.clanCount); }

  async getEmbers() { return []; }

  async getTiers() {
    const out = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key || !key.startsWith(PREFIX + "player:")) continue;
        const p = readJson(key.slice(PREFIX.length));
        if (p && typeof p.handle === "string" && Number.isInteger(p.tier) && p.tier > 0) out.push([p.handle, p.tier]);
      }
    } catch { /* storage blocked */ }
    return out;
  }

  _save(player) {
    if (!writeJson("player:" + player.handle, player)) {
      throw new Error("Couldn't save on this device (storage is blocked).");
    }
  }
}

// ------------------------------------------------------------------ online (Supabase)
const NETWORK_ERROR = "Couldn't reach the island. Check your connection and try again.";

export class OnlineStore {
  /** @param {string} url Supabase project URL  @param {string} key publishable key  @param {number} clanCount */
  constructor(url, key, clanCount) {
    this.mode = "online";
    this.base = url.replace(/\/+$/, "") + "/rest/v1/rpc/";
    this.key = key;
    this.clanCount = clanCount;
  }

  async _rpc(name, args) {
    let res;
    try {
      res = await fetch(this.base + name, {
        method: "POST",
        headers: { apikey: this.key, "Content-Type": "application/json" },
        body: JSON.stringify(args || {}),
      });
    } catch {
      throw new Error(NETWORK_ERROR);
    }
    if (!res.ok) throw new Error(NETWORK_ERROR);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  _token(handle) {
    const t = readJson("token:" + handle);
    return typeof t === "string" ? t : "";
  }

  needsSignIn(handle) { return !this._token(handle); }

  async signIn(handle, code) {
    const r = await this._rpc("sign_in", { p_handle: handle, p_code: String(code || "").trim() });
    if (r && r.ok && typeof r.token === "string") {
      writeJson("token:" + handle, r.token);
      return { ok: true, message: "" };
    }
    return { ok: false, message: (r && r.message) || "Sign-in failed." };
  }

  async load(handle) {
    return this.perform(handle, "get", null, 0);
  }

  async perform(handle, action, resource, qty) {
    const r = await this._rpc("play", {
      p_token: this._token(handle), p_action: action, p_resource: resource ?? null, p_qty: qty | 0,
    });
    if (!r || typeof r !== "object") throw new Error(NETWORK_ERROR);
    if (r.signed_out) {
      removeKey("token:" + handle);
      return { ok: false, signedOut: true, player: null, message: r.message || "Please sign in again." };
    }
    if (!r.player || r.player.handle !== handle) throw new Error(NETWORK_ERROR);
    return {
      ok: Boolean(r.ok),
      player: r.player,
      message: r.message || "",
      gained: r.gained || undefined,
      lanterns: r.lanterns || 0,
    };
  }

  async getIsland() {
    try {
      return cleanIsland(await this._rpc("get_island"), this.clanCount);
    } catch {
      return emptyIsland(this.clanCount);
    }
  }

  async getEmbers() {
    try {
      const rows = await this._rpc("island_embers");
      return Array.isArray(rows)
        ? rows.filter(r => Array.isArray(r) && typeof r[0] === "string" && Number.isInteger(r[1]))
        : [];
    } catch {
      return [];
    }
  }

  async getTiers() {
    try {
      const rows = await this._rpc("island_tiers");
      return Array.isArray(rows)
        ? rows.filter(r => Array.isArray(r) && typeof r[0] === "string" && Number.isInteger(r[1]))
        : [];
    } catch {
      return [];
    }
  }
}
