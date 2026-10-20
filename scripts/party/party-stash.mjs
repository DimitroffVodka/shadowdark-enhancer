/**
 * Party stash: the shared inventory's capacity.
 *
 * Free mode keeps the party's own allowance (the legacy partyMaxSlots, else 10).
 * Donated mode makes the capacity the sum of what members reserve; a character's
 * reservation is a real "Party stash" item on their sheet (so it takes their
 * slots), and a mount's reservation is shown as load on its gear tab.
 *
 * The party flag `flags.shadowdark-enhancer.partyStash` is authoritative:
 * `{ [memberId]: slots }` (actor ids). The filler items are projections of that flag.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { mountLoad } from "../actors/mount-load.mjs";
import { Party, isParty } from "./party.mjs";
import { coinsOf, inventorySlots } from "./party-sheet-core.mjs";
import { donationLimit, normalizeDonations, planDonation, stashCapacity } from "./party-stash-core.mjs";

const STASH_FLAG = "partyStash";
const STASH_PARTY = "partyStashParty";
const STASH_ACTOR = "partyStashActor";
const STASH_WRITE = "partyStashWrite";
const GROUPED = ["characters", "hirelings", "mounts"];
export const PARTY_STASH_CHANGED = `${MODULE_ID}.partyStashChanged`;

export const stashMode = () => {
  try { return game.settings.get(MODULE_ID, "partyStashMode") === "donated" ? "donated" : "free"; }
  catch { return "free"; }
};

const partyCoins = (party) => coinsOf(party?.flags?.[MODULE_ID]?.partyCoins ?? party?.flags?.["shadowdark-extras"]?.coins);
const partyUsed = (party) => inventorySlots(party?.items?.contents ?? [], partyCoins(party));

/** The filler item on a character/hireling, if any. */
export const stashItemOf = (actor) => actor?.items?.find?.((item) => item.flags?.[MODULE_ID]?.[STASH_FLAG] === true) ?? null;
export const stashSlotsOf = (actor) => Math.max(0, Math.trunc(Number(stashItemOf(actor)?.system?.slots?.slots_used) || 0));

const stashName = (slots) => game.i18n.format("SDE.party.stash.itemName", { slots });
const stashDescription = () => game.i18n.localize("SDE.party.stash.itemDescription");

function stashItemData(actor, slots, party) {
  return {
    name: stashName(slots), type: "Basic", img: "icons/svg/item-bag.svg",
    system: {
      description: stashDescription(), quantity: 1, slots: { per_slot: 1, slots_used: slots, free_carry: 0 },
      cost: { gp: 0, sp: 0, cp: 0 }, stashed: false, equipped: false, magicItem: false,
    },
    flags: { [MODULE_ID]: { [STASH_FLAG]: true, [STASH_PARTY]: party.uuid, [STASH_ACTOR]: actor.uuid } },
  };
}

/** Create, resize or remove the filler item that makes a reservation real on a character's sheet. */
export async function ensureStashItem(actor, slots, party) {
  const value = Math.max(0, Math.trunc(Number(slots) || 0));
  const existing = stashItemOf(actor);
  if (!value) {
    if (existing) await existing.delete({ [MODULE_ID]: { [STASH_WRITE]: true } });
    return null;
  }
  if (existing) {
    const patch = {};
    if (existing.name !== stashName(value)) patch.name = stashName(value);
    if (Number(existing.system?.slots?.slots_used) !== value) patch["system.slots.slots_used"] = value;
    if (existing.flags?.[MODULE_ID]?.[STASH_PARTY] !== party.uuid) patch[`flags.${MODULE_ID}.${STASH_PARTY}`] = party.uuid;
    if (Object.keys(patch).length) await existing.update(patch, { [MODULE_ID]: { [STASH_WRITE]: true } });
    return existing;
  }
  const [item] = await actor.createEmbeddedDocuments("Item", [stashItemData(actor, value, party)], { [MODULE_ID]: { [STASH_WRITE]: true } });
  return item ?? null;
}

export async function deleteStashItem(actor) {
  const existing = stashItemOf(actor);
  if (existing) await existing.delete({ [MODULE_ID]: { [STASH_WRITE]: true } });
}

/** A member's capacity, the slots already used, and the most they may reserve. */
export function memberStashInfo(row, donation = 0) {
  const actor = row?.actor;
  if (!actor) return null;
  const value = Math.max(0, Math.trunc(Number(donation) || 0));
  if (row.group === "mounts") {
    const load = mountLoad(actor);
    return { kind: "mount", max: load.max, used: load.load, stash: value, limit: load.free, free: Math.max(0, load.free - value), over: value > load.free };
  }
  const max = Math.max(0, Math.trunc(Number(actor.system?.slots ?? 10) || 0));
  const itemSlots = stashSlotsOf(actor);
  const used = inventorySlots(actor.items?.contents ?? [], actor.system?.coins);
  const usedWithout = Math.max(0, used - itemSlots);
  const limit = donationLimit({ max, used, stash: itemSlots });
  return { kind: "actor", max, used: usedWithout, stash: value, limit, free: Math.max(0, limit - value), over: value > limit };
}

/** Every member who may carry part of the shared inventory, for the Items tab. */
export function stashRows(rows, donations = {}) {
  return (rows ?? [])
    .filter((row) => row.actor && GROUPED.includes(row.group))
    .map((row) => {
      const donation = Math.max(0, Math.trunc(Number(donations?.[row.actor.id]) || 0));
      const info = memberStashInfo(row, donation);
      return {
        id: row.actor.id, name: row.actor.name, group: row.group, donation,
        ...info,
        canDonate: !!game.user?.isGM || !!row.actor.canUserModify?.(game.user, "update"),
      };
    });
}

/** The Items tab's stash view. Free mode keeps the old allowance and needs no rows. */
export function partyStashContext(party, rows, { canEdit = false } = {}) {
  const mode = stashMode();
  const memberIds = (rows ?? []).filter((row) => row.actor && GROUPED.includes(row.group)).map((row) => row.actor.id);
  const saved = normalizeDonations(party?.flags?.[MODULE_ID]?.partyStash, memberIds);
  const donations = mode === "donated" ? saved : {};
  const capacity = stashCapacity({ mode, legacyMax: party?.flags?.["shadowdark-extras"]?.partyMaxSlots, donations });
  const used = partyUsed(party);
  return { mode, donated: mode === "donated", free: mode !== "donated", capacity, used, over: used > capacity, donations, canEdit,
    rows: mode === "donated" ? stashRows(rows, donations) : [] };
}

/** What this actor has reserved in any party it belongs to; the mount sheet shows it as load. */
export function partyStashForActor(actor) {
  if (!actor?.id || stashMode() !== "donated") return 0;
  for (const party of Party.list() ?? []) {
    const slots = Math.max(0, Math.trunc(Number(party.flags?.[MODULE_ID]?.partyStash?.[actor.id]) || 0));
    if (slots) return slots;
  }
  return 0;
}

/**
 * Set one member's reservation, by actor id. The party flag is the authority; a
 * character's filler item is written first so a failed flag write can put it back.
 */
export async function setDonation(party, memberId, requested) {
  if (!Party.canManage(party)) return { ok: false, reason: "SDE.party.noPermission" };
  if (stashMode() !== "donated") return { ok: false, reason: "SDE.party.stash.refuse.mode" };
  const rows = Party.rows(party), row = rows.find((r) => r.actor?.id === memberId);
  if (!row?.actor || !GROUPED.includes(row.group)) return { ok: false, reason: "SDE.party.stash.refuse.member" };
  if (!game.user?.isGM && !row.actor.canUserModify?.(game.user, "update")) return { ok: false, reason: "SDE.party.stash.refuse.owner" };

  const memberIds = rows.filter((r) => r.actor && GROUPED.includes(r.group)).map((r) => r.actor.id);
  const donations = normalizeDonations(party.flags?.[MODULE_ID]?.partyStash, memberIds);
  const info = memberStashInfo(row, donations[memberId] ?? 0);
  const planned = planDonation({ donations, memberId, requested, limit: info.limit, partyUsed: partyUsed(party), mode: "donated" });
  if (!planned.ok) return planned;

  const before = stashSlotsOf(row.actor);
  try {
    if (row.group !== "mounts") await ensureStashItem(row.actor, planned.value, party);
    await replaceModuleFlag(party, "partyStash", planned.donations);
  } catch (error) {
    if (row.group !== "mounts") {
      try { await ensureStashItem(row.actor, before, party); } catch { /* the party flag was not written either */ }
    }
    throw error;
  }
  return { ...planned, memberId };
}

/** Bring every party's projections back in line with its flag (active GM only). */
export async function reconcilePartyStash(party) {
  if (!party || !isParty(party)) return;
  const rows = Party.rows(party), memberIds = rows.filter((r) => r.actor && GROUPED.includes(r.group)).map((r) => r.actor.id);
  const raw = party.flags?.[MODULE_ID]?.partyStash ?? {};
  const donations = normalizeDonations(raw, memberIds);

  // A member who left (or an orphan entry) loses its reservation and filler.
  for (const id of Object.keys(raw)) {
    if (memberIds.includes(id)) continue;
    const actor = game.actors?.contents?.find((a) => a.id === id);
    if (actor) await deleteStashItem(actor);
  }
  // A filler with no matching reservation is a projection without a flag: remove it.
  for (const actor of game.actors?.contents ?? []) {
    const item = stashItemOf(actor);
    if (item?.flags?.[MODULE_ID]?.[STASH_PARTY] === party.uuid && !donations[actor.id]) await deleteStashItem(actor);
  }

  if (stashMode() === "free") {
    for (const id of Object.keys(donations)) {
      const actor = game.actors?.contents?.find((a) => a.id === id);
      if (actor) await deleteStashItem(actor);
    }
    if (Object.keys(raw).length) await replaceModuleFlag(party, "partyStash", {});
    return;
  }

  for (const [id, slots] of Object.entries(donations)) {
    const row = rows.find((r) => r.actor?.id === id);
    if (row?.group !== "mounts" && row?.actor) await ensureStashItem(row.actor, slots, party);
  }
  if (JSON.stringify(donations) !== JSON.stringify(raw)) await replaceModuleFlag(party, "partyStash", donations);
}

export async function reconcileAllPartyStashes() {
  if (!isActiveGM()) return;
  const parties = Party.list(), uuids = new Set(parties.map((party) => party.uuid));
  // A filler whose party no longer exists cannot be reconciled per party: remove it here.
  for (const actor of game.actors?.contents ?? []) {
    const item = stashItemOf(actor);
    const partyUuid = item?.flags?.[MODULE_ID]?.[STASH_PARTY];
    if (partyUuid && !uuids.has(partyUuid)) await deleteStashItem(actor);
  }
  for (const party of parties) await reconcilePartyStash(party);
}

/** The setting changed: reconcile on the authority client, then let open sheets re-read it. */
export async function onStashModeChanged() {
  await reconcileAllPartyStashes();
  Hooks.callAll(PARTY_STASH_CHANGED);
}

export function registerPartyStash() {
  // A reservation is managed from the Party sheet; its filler item is not a
  // normal inventory item. Actor deletion does not run these hooks, so a PC
  // can still be deleted.
  Hooks.on("preUpdateItem", (item, _changes, options) => {
    if (!item.flags?.[MODULE_ID]?.[STASH_FLAG] || options?.[MODULE_ID]?.[STASH_WRITE]) return;
    ui.notifications?.warn(game.i18n.localize("SDE.party.stash.locked"));
    return false;
  });
  Hooks.on("preDeleteItem", (item, options) => {
    if (!item.flags?.[MODULE_ID]?.[STASH_FLAG] || options?.[MODULE_ID]?.[STASH_WRITE]) return;
    ui.notifications?.warn(game.i18n.localize("SDE.party.stash.locked"));
    return false;
  });
  Hooks.on("preCreateItem", (item, _data, options) => {
    if (!item.flags?.[MODULE_ID]?.[STASH_FLAG] || options?.[MODULE_ID]?.[STASH_WRITE]) return;
    const owner = item.flags?.[MODULE_ID]?.[STASH_ACTOR];
    const duplicate = item.parent?.items?.some?.((other) => other.flags?.[MODULE_ID]?.[STASH_FLAG]);
    if ((owner && item.parent?.uuid !== owner) || duplicate) {
      ui.notifications?.warn(game.i18n.localize("SDE.party.stash.locked"));
      return false;
    }
  });
  Hooks.on("updateActor", (actor, changes) => {
    if (!isActiveGM() || !isParty(actor) || !changes.flags?.[MODULE_ID]?.partyData) return;
    void reconcilePartyStash(actor);
  });
  Hooks.on("deleteActor", async (actor) => {
    if (!isActiveGM()) return;
    if (isParty(actor)) {
      for (const id of Object.keys(actor.flags?.[MODULE_ID]?.partyStash ?? {})) {
        const member = game.actors?.contents?.find((a) => a.id === id);
        if (member) await deleteStashItem(member);
      }
      return;
    }
    for (const party of Party.list()) {
      if (party.flags?.[MODULE_ID]?.partyStash?.[actor.id]) await reconcilePartyStash(party);
    }
  });
  Hooks.once("ready", () => { void reconcileAllPartyStashes(); });
}
