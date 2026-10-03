/**
 * Party sheet: the decisions the sheet makes that need no Foundry (who sees what, the
 * tab row, what the Marching order line says). No Foundry globals, so Node tests it
 * and the design harness renders the same answers the sheet gives.
 */

/**
 * The tab row. Travel (Camp, Carouse and the travel panels) is the GM's; Bastion is there
 * once the party has a bastion its viewer may see.
 * @param {{ isGM?: boolean, hasBastion?: boolean }} view
 * @returns {string[]}
 */
export function partyTabs({ isGM = false, hasBastion = false } = {}) {
  return ["members", "items", ...(isGM ? ["travel"] : []), "quests", ...(hasBastion ? ["bastion"] : []), "description"];
}

/** A tab the viewer cannot see (Travel for a player, Bastion once unlinked) falls back to Members. */
export const resolveTab = (tab, keys) => (keys.includes(tab) ? tab : "members");

/**
 * What a viewer may change. `canEdit` is the party's rule (a GM, or an owner of the party);
 * the emblem is the GM's alone.
 * @param {{ isGM?: boolean, canEdit?: boolean }} who
 */
export function sheetView({ isGM = false, canEdit = false } = {}) {
  return { isGM: !!isGM, canEdit: !!canEdit, emblemEdit: !!isGM && !!canEdit };
}

/**
 * The Marching order line under the switch.
 *   free     the switch is off: the party moves freely
 *   leads    marching, or nothing to report: "<leader> leads"
 *   paused   the members are out and following has stopped (`reason`); a manager may resume
 *            unless combat is what stopped it
 *   notice   marching is on but there is nothing running to follow: no party token to
 *            place from (managers only), or the members were recalled
 *   none     marching with nobody to lead
 * `reason` is the movement status reason ("" when following runs).
 * @returns {{ mode: "free"|"leads"|"paused"|"notice"|"none", reason?: string, canResume?: boolean, pausedMember?: string|null }}
 */
export function marchState({ follow = true, hasToken = false, deployed = false, reason = "", pausedMember = null, manager = false, hasLeader = false } = {}) {
  const leads = hasLeader ? { mode: "leads" } : { mode: "none" };
  if (!follow) return { mode: "free" };
  if (!hasToken) return manager ? { mode: "notice", reason: "noToken" } : leads;
  if (reason === "combat") return { mode: "paused", reason, canResume: false, pausedMember: null };
  if (deployed && reason) return { mode: "paused", reason, canResume: !!manager, pausedMember: pausedMember ?? null };
  if (reason === "gathered") return { mode: "notice", reason };
  return leads;
}

// ---------------------------------------------------------------- Gems

/** A cost {gp, sp, cp} in copper (1 gp = 10 sp = 100 cp); a missing or odd part counts as 0. */
const copper = (cost) => ["gp", "sp", "cp"].reduce((sum, key, i) => sum + Math.max(0, Math.trunc(Number(cost?.[key]) || 0)) * [100, 10, 1][i], 0);

/** Copper as gp text: whole when whole, else to the copper ("12", "0.5", "0.07"). */
export const gpText = (cp) => String(Math.round(cp) / 100);

/**
 * The party's gems: its items of the Shadowdark system's Gem type, with each gem's value (its
 * cost; the system keeps a gem's worth in `system.cost`), the quantity held, and the total.
 * @param {Array<{id?:string, name:string, img?:string, type?:string, system?:{quantity?:number, cost?:object}}>} items
 */
export function gemSummary(items = []) {
  const rows = (items ?? []).filter((item) => item?.type === "Gem").map((item) => {
    const each = copper(item.system?.cost), quantity = Math.max(0, Math.trunc(Number(item.system?.quantity ?? 1)) || 0);
    return { id: item.id, name: item.name, img: item.img, quantity, value: gpText(each), total: each * quantity };
  });
  return { rows, total: gpText(rows.reduce((sum, row) => sum + row.total, 0)), count: rows.reduce((sum, row) => sum + row.quantity, 0) };
}
