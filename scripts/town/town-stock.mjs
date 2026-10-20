/**
 * Shadowdark Enhancer — Town: a merchant's rolled shelf (Foundry side).
 *
 * A merchant made by the module (Generate, or Make a landing page) remembers its kind and settlement size on the
 * page (`stock`), and its shelf is rolled from the gear packs by rarity (merchant/stock-generator.mjs): once when it is
 * made, and again whenever its shelf is restocked, so the goods change between sessions. Only the items the roll put
 * there are replaced; anything the GM added by hand stays. GM only.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { toCopper } from "../shared/coins.mjs";
import { L as t } from "../shared/i18n.mjs";
import { KINDS, pickStock, stockItem } from "../merchant/stock-generator.mjs";

/** Marks an item the roll put on the shelf (the next roll replaces it). */
export const ROLLED_FLAG = "rolled";

/** Every non-magic Catalog ware a shop of `kind` could carry: `{ uuid, name, type, costCp }`, system gear first. */
async function stockPool(kind) {
  const { SHOP_PACKS } = await import("../bastion/bastion-shop.mjs");
  const { inStock } = await import("../bastion/bastion-shop-core.mjs");
  const pool = [];
  for (const id of SHOP_PACKS) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: ["system.cost", "system.quantity", "system.magicItem", "system.treasure", `flags.${MODULE_ID}.fromTreasureTable`, `flags.${MODULE_ID}.adventureTreasure`, `flags.${MODULE_ID}.generated`, `flags.${MODULE_ID}.siegeWeapon`] });
    for (const entry of index.contents) {
      if (kind.types.some((type) => inStock(entry, { type }))) pool.push({ uuid: entry.uuid, name: entry.name, type: entry.type, costCp: toCopper(entry.system.cost ?? {}), siege: !!entry.flags?.[MODULE_ID]?.siegeWeapon });
    }
  }
  return pool;
}

/** The item data of a fresh roll for `{ kind, size }`, each marked as rolled. */
async function rollItems({ kind, size }) {
  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0];
  const items = [];
  for (const pick of pickStock(await stockPool(k), { kind: k.id, size })) {
    const doc = await fromUuid(pick.uuid).catch(() => null);
    if (!doc) continue;
    const data = stockItem(doc.toObject(), pick.bundles);
    data.flags = { ...data.flags, [MODULE_ID]: { ...data.flags?.[MODULE_ID], [ROLLED_FLAG]: true } };
    items.push(data);
  }
  return items;
}

/** Roll `actor`'s shelf again: the last roll's items go, a new roll comes in, the GM's own items stay. */
export async function rollShelf(actor, stock) {
  if (!game.user.isGM || !actor || !stock) return;
  const items = await rollItems(stock);
  const old = actor.items.filter((i) => i.getFlag(MODULE_ID, ROLLED_FLAG)).map((i) => i.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  if (items.length) await actor.createEmbeddedDocuments("Item", items);
}

/** The Actor folder a scene's generated merchants go in. */
async function merchantFolder(sceneName) {
  const name = t("SDE.town.editor.generateFolder", { scene: sceneName });
  return game.folders.find((f) => f.type === "Actor" && f.name === name) ?? Folder.create({ name, type: "Actor" });
}

/**
 * Make an NPC merchant of `kind` stocked for a settlement of `size`, in the scene's merchant folder. Returns the actor
 * (null when it could not be made). A short shelf is said, never fatal: the NPC is still the GM's to fill by hand.
 */
export async function makeMerchant({ kind, size, sceneName }) {
  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0];
  const items = await rollItems({ kind: k.id, size });
  if (!items.length) { ui.notifications.warn(t("SDE.town.editor.generateEmpty")); return null; }
  const folder = await merchantFolder(sceneName);
  const actor = await Actor.create({ name: `${t(k.labelKey)}, ${sceneName}`, type: "NPC", folder: folder?.id ?? null });
  if (!actor) { ui.notifications.error(t("SDE.town.editor.generateFailed")); return null; }
  await actor.createEmbeddedDocuments("Item", items).catch((err) => console.error("Shadowdark Enhancer | generate merchant: items", err));
  if (actor.items.size < items.length) ui.notifications.warn(t("SDE.town.editor.generateFailed"));
  return actor;
}

/**
 * After the GM's side wrote a page: roll again the shelf of every rolled merchant whose revision went up (a restock,
 * by hand or by the clock). `before` and `after` are the page as it was and as written.
 */
export async function rerollRestocked(before, after) {
  const was = new Map((before?.merchants ?? []).map((m) => [m.id, m.rev]));
  for (const m of after?.merchants ?? []) {
    if (!m.stock || !was.has(m.id) || m.rev <= was.get(m.id)) continue;
    try { await rollShelf(game.actors.get(m.actorId), m.stock); }
    catch (err) { console.error("Shadowdark Enhancer | restock roll failed for", m.actorId, err); }
  }
}
