// Play panel: the daily loop (work -> build -> light lanterns -> trade) for one settler.
// All saving and rule checks go through the store (device demo or online server).
import { upgrade, upgradeCost, ENERGY_PER_DAY, JOB_YIELDS, LANTERN_COST, BUY_PRICE, SELL_PRICE } from "./economy.js";

const $ = id => document.getElementById(id);
const TRADE_QTY = 5;
const ICONS = { coins: "🪙", wood: "🪵", stone: "🪨", food: "🐟" };
const VERBS = {
  "Rice Farmer": "Farm rice", "Fisher": "Go fishing", "Woodcutter": "Chop wood",
  "Stonemason": "Cut stone", "Carpenter": "Do carpentry", "Shrine Keeper": "Tend the shrine",
};
const ACTION_BUTTONS = ["p-work", "p-upgrade", "p-donate", "p-buy", "p-sell"];

const costText = cost => Object.entries(cost).map(([k, v]) => `${v} ${ICONS[k]}`).join(" ");
const gainText = gained => Object.entries(gained).map(([k, v]) => `+${v} ${k}`).join(", ");
const errText = err => (err instanceof Error ? err.message : "Something went wrong. Please try again.");

/**
 * @param {{ data: object, store: object, instagram: string,
 *           onTier: (handle: string, tier: number) => void,
 *           onIsland: () => void, onClose: () => void }} deps
 */
export function createPlay({ data, store, instagram, onTier, onIsland, onClose }) {
  let player = null;
  let house = null;
  let busy = false;

  function toast(text, bad = false) {
    $("p-toast").textContent = text;
    $("p-toast").classList.toggle("bad", bad);
  }

  function showHeader(handle, tier) {
    $("p-name").textContent = "@" + handle;
    $("p-job").textContent = data.jobs[house.job] || "";
    $("p-home").textContent = data.tiers[tier] || "";
    $("p-lanterns").textContent = player ? `${player.lanterns} lantern${player.lanterns === 1 ? "" : "s"} lit by you` : "";
  }

  function render() {
    const p = player;
    showHeader(p.handle, p.tier);
    $("p-energy").textContent = `${p.energy}/${ENERGY_PER_DAY}`;
    $("p-energy-bar").style.width = `${(100 * p.energy) / ENERGY_PER_DAY}%`;
    for (const k of ["coins", "wood", "stone", "food"]) $("p-" + k).textContent = p[k];

    const yieldText = gainText({ ...JOB_YIELDS[p.job], coins: (JOB_YIELDS[p.job].coins || 0) + 1 });
    $("p-work").textContent = p.energy > 0 ? `${VERBS[p.job]} (${yieldText})` : "Out of energy: back tomorrow";
    $("p-work").disabled = busy || p.energy < 1;

    const cost = upgradeCost(p.tier);
    $("p-upgrade").textContent = cost ? `Build a ${data.tiers[p.tier + 1]}: ${costText(cost)}` : "Your manor is complete";
    $("p-upgrade").disabled = busy || !cost || !upgrade(p).ok;

    const dRes = $("p-donate-res").value;
    $("p-donate").textContent = `Light 1 lantern (${LANTERN_COST} ${dRes})`;
    $("p-donate").disabled = busy || p[dRes] < LANTERN_COST;

    const tRes = $("p-trade-res").value;
    $("p-buy").textContent = `Buy ${TRADE_QTY} for ${TRADE_QTY * BUY_PRICE} 🪙`;
    $("p-sell").textContent = `Sell ${TRADE_QTY} for ${TRADE_QTY * SELL_PRICE} 🪙`;
    $("p-buy").disabled = busy || p.coins < TRADE_QTY * BUY_PRICE;
    $("p-sell").disabled = busy || p[tRes] < TRADE_QTY;
  }

  function showSignIn() {
    player = null;
    showHeader(house.handle, house.tier);
    $("p-signin-handle").textContent = "@" + house.handle;
    $("p-ig").textContent = instagram ? "@" + instagram : "us";
    $("p-code").value = "";
    $("p-signin").hidden = false;
    $("p-game").hidden = true;
  }

  function showGame(next) {
    player = next;
    $("p-signin").hidden = true;
    $("p-game").hidden = false;
    render();
    if (next.tier !== house.tier) onTier(next.handle, next.tier);
  }

  /** Send one action to the store; the store (or server) decides what really happened. */
  async function act(action, resource, qty, onOk) {
    if (!player || busy) return;
    busy = true;
    ACTION_BUTTONS.forEach(id => { $(id).disabled = true; });
    try {
      const r = await store.perform(player.handle, action, resource, qty);
      if (r.signedOut) { showSignIn(); toast(r.message, true); return; }
      player = r.player || player;
      if (!r.ok) { toast(r.message, true); return; }
      await onOk(r);
    } catch (err) {
      toast(errText(err), true);
    } finally {
      busy = false;
      if (player) render();
    }
  }

  $("p-work").addEventListener("click", () =>
    act("work", null, 0, r => toast(gainText(r.gained || {}))));

  $("p-upgrade").addEventListener("click", () =>
    act("upgrade", null, 0, r => {
      toast(`Your new ${data.tiers[r.player.tier]} is ready!`);
      onTier(r.player.handle, r.player.tier);
    }));

  $("p-donate").addEventListener("click", () =>
    act("donate", $("p-donate-res").value, LANTERN_COST, r => {
      toast(`You lit ${r.lanterns} lantern. The Mist pulls back a little.`);
      onIsland();
    }));

  $("p-buy").addEventListener("click", () =>
    act("buy", $("p-trade-res").value, TRADE_QTY, () => toast(`Bought ${TRADE_QTY} ${$("p-trade-res").value}.`)));
  $("p-sell").addEventListener("click", () =>
    act("sell", $("p-trade-res").value, TRADE_QTY, () => toast(`Sold ${TRADE_QTY} ${$("p-trade-res").value}.`)));

  $("p-donate-res").addEventListener("change", () => player && render());
  $("p-trade-res").addEventListener("change", () => player && render());

  $("p-signin-form").addEventListener("submit", async e => {
    e.preventDefault();
    const code = $("p-code").value.replace(/\D/g, "");
    if (code.length !== 6) { toast("The code has 6 digits.", true); return; }
    $("p-signin-btn").disabled = true;
    try {
      const r = await store.signIn(house.handle, code);
      if (!r.ok) { toast(r.message, true); return; }
      const loaded = await store.load(house.handle, startFor(house));
      if (!loaded.ok && loaded.signedOut) { toast(loaded.message, true); return; }
      showGame(loaded.player);
      toast(`Welcome to the island, @${house.handle}! Start by working your job.`);
    } catch (err) {
      toast(errText(err), true);
    } finally {
      $("p-signin-btn").disabled = false;
    }
  });

  $("play-close").addEventListener("click", () => {
    $("play").hidden = true;
    $("foot").hidden = false;
    onClose();
  });

  $("p-mode").textContent = store.mode === "device"
    ? "Demo: your progress is saved on this device only."
    : "";

  function startFor(target) {
    return { job: data.jobs[target.job], tier: target.tier, clan: target.clan };
  }

  return {
    /** Open the panel for a house on the map. */
    async open(target) {
      house = target;
      toast("");
      if (store.rememberClan) store.rememberClan(target.handle, target.clan);
      $("foot").hidden = true;
      $("play").hidden = false;
      if (store.needsSignIn(target.handle)) { showSignIn(); return; }
      try {
        const r = await store.load(target.handle, startFor(target));
        if (r.signedOut) { showSignIn(); return; }
        showGame(r.player);
        toast(r.fresh ? `Welcome to the island, @${target.handle}! Start by working your job.` : r.message);
      } catch (err) {
        showHeader(target.handle, target.tier);
        $("p-signin").hidden = true;
        $("p-game").hidden = true;
        toast(errText(err), true);
      }
    },
  };
}
