/**
 * Shadowdark Enhancer — shared coin arithmetic.
 *
 * Shadowdark currency: 10 cp = 1 sp, 10 sp = 1 gp → 1 gp = 100 cp.
 *
 * Pure, Foundry-free helpers so the money math is testable in isolation and
 * shared across the merchant shop, loot delivery, and item drops instead of
 * being re-implemented per module.
 */

/** Convert a { gp, sp, cp } object to a single copper value. */
export function toCopper(c) {
  return (c?.gp ?? 0) * 100 + (c?.sp ?? 0) * 10 + (c?.cp ?? 0);
}

/** Convert a copper total back to canonical { gp, sp, cp }. */
export function fromCopper(total) {
  total = Math.max(0, Math.round(total));
  return { gp: Math.floor(total / 100), sp: Math.floor((total % 100) / 10), cp: total % 10 };
}

/** Format a cost object as a short string like "2 gp 5 sp" or "10 cp". */
export function formatPrice(c) {
  const parts = [];
  if (c?.gp) parts.push(`${c.gp} gp`);
  if (c?.sp) parts.push(`${c.sp} sp`);
  if (c?.cp) parts.push(`${c.cp} cp`);
  return parts.length ? parts.join(" ") : "Free";
}

/** True when a purse holds at least `cost`. */
export function canAfford(coins, cost) {
  return toCopper(coins) >= toCopper(cost);
}

/** Apply a percentage sell ratio to a cost, returning the adjusted price. */
export function applySellRatio(cost, ratio) {
  return fromCopper(Math.floor(toCopper(cost) * ratio / 100));
}

/**
 * Add a { gp, sp, cp } amount to a purse WITHOUT renormalizing. Adding
 * field-by-field keeps the player's existing denominations intact (unlike
 * `fromCopper(toCopper(purse) + …)`, which would collapse e.g. 150 sp into
 * 15 gp on the next transaction).
 */
export function addToPurse(purse, add) {
  return {
    gp: Math.max(0, Math.floor(purse?.gp ?? 0)) + Math.max(0, Math.floor(add?.gp ?? 0)),
    sp: Math.max(0, Math.floor(purse?.sp ?? 0)) + Math.max(0, Math.floor(add?.sp ?? 0)),
    cp: Math.max(0, Math.floor(purse?.cp ?? 0)) + Math.max(0, Math.floor(add?.cp ?? 0)),
  };
}

/**
 * Subtract a copper cost from a purse, preserving denominations as much as
 * possible: pay from cp, then sp, then gp, breaking a single higher coin into
 * change only when the lower denominations run short. Total value removed is
 * always exactly `costCopper` (assumes the purse can afford it — check with
 * `canAfford` first).
 */
export function spendFromPurse(purse, costCopper) {
  let gp = Math.max(0, Math.floor(purse?.gp ?? 0));
  let sp = Math.max(0, Math.floor(purse?.sp ?? 0));
  let cp = Math.max(0, Math.floor(purse?.cp ?? 0));
  let need = Math.max(0, Math.round(costCopper));

  // Copper first.
  const fromCp = Math.min(cp, need);
  cp -= fromCp; need -= fromCp;

  // Silver (10 cp each); break one more sp into cp for any remainder.
  if (need > 0) {
    const useSp = Math.min(sp, Math.floor(need / 10));
    sp -= useSp; need -= useSp * 10;
    if (need > 0 && sp > 0) { sp -= 1; cp += 10 - need; need = 0; }
  }

  // Gold (100 cp each); break one more gp into sp + cp for any remainder.
  if (need > 0) {
    const useGp = Math.min(gp, Math.floor(need / 100));
    gp -= useGp; need -= useGp * 100;
    if (need > 0 && gp > 0) {
      gp -= 1;
      const change = 100 - need; // 1..99
      need = 0;
      sp += Math.floor(change / 10);
      cp += change % 10;
    }
  }

  return { gp, sp, cp };
}

/** Extract coin amounts from free-text roll-table results ("50 gp", "3 Silver"). */
export function parseCoinsFromText(text) {
  const coins = { gp: 0, sp: 0, cp: 0 };
  if (!text) return coins;
  const t = String(text);
  const grab = (re) => { const m = t.match(re); return m ? (parseInt(m[1], 10) || 0) : 0; };
  coins.gp = grab(/(\d+)\s*(?:gp|gold)\b/i);
  coins.sp = grab(/(\d+)\s*(?:sp|silver)\b/i);
  coins.cp = grab(/(\d+)\s*(?:cp|copper)\b/i);
  return coins;
}
