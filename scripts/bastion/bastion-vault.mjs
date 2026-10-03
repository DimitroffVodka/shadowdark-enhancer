/**
 * Shadowdark Enhancer — Bastions: moving items into and out of the Vault.
 *
 * Stored items are embedded items on the bastion actor. A move is a copy first and a delete second,
 * each read back, and a copy whose original could not be removed is taken out again, so an item is
 * never in two places and never lost.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { effects, stateOf } from "./bastion-core.mjs";
import { canStore, slotsOf, VAULT_TYPES } from "./bastion-vault-core.mjs";

const itemsOf = (actor) => [...(actor.items?.contents ?? actor.items ?? [])];
const has = (actor, id) => !!actor.items?.get?.(id);

/** Copy `item` onto `target` and read it back: the new document, or null. */
async function copyTo(target, item) {
  const data = item.toObject();
  delete data._id;
  const made = await target.createEmbeddedDocuments("Item", [data]).catch((err) => { console.error(`${MODULE_ID} | vault: copy`, err); return null; });
  const doc = made?.[0];
  return doc && has(target, doc.id) ? doc : null;
}

/**
 * Put `item` in the vault. An item held by a character is moved (taken from them); any other item
 * is copied. `error`: "gm" | "vault" | "type" | "full" (with `short`) | "same" | "write".
 */
export async function storeItem(vault, item) {
  if (!game.user?.isGM) return { ok: false, error: "gm" };
  if (!effects(stateOf(vault)).vault) return { ok: false, error: "vault" };
  if (item.parent?.id === vault.id) return { ok: false, error: "same" };
  const check = canStore(itemsOf(vault), item);
  if (!check.ok) return { ok: false, error: check.error, short: check.short };
  const copy = await copyTo(vault, item);
  if (!copy) return { ok: false, error: "write" };
  if (item.parent?.documentName === "Actor") {
    const owner = item.parent;
    await Promise.resolve(item.delete()).catch((err) => console.error(`${MODULE_ID} | vault: remove original`, err));
    if (has(owner, item.id)) {
      await Promise.resolve(copy.delete()).catch((err) => console.error(`${MODULE_ID} | vault: undo copy`, err));
      return { ok: false, error: "write" };
    }
  }
  return { ok: true, error: null, slots: slotsOf(copy), name: copy.name };
}

/** Take an item out of the vault to a character: copied there, then removed from the vault. */
export async function takeOut(vault, itemId, character) {
  if (!game.user?.isGM) return { ok: false, error: "gm" };
  const item = vault.items.get(itemId);
  if (!item || !VAULT_TYPES.includes(item.type) || !character) return { ok: false, error: "none" };
  const copy = await copyTo(character, item);
  if (!copy) return { ok: false, error: "write" };
  await Promise.resolve(item.delete()).catch((err) => console.error(`${MODULE_ID} | vault: remove stored`, err));
  if (has(vault, itemId)) {
    await Promise.resolve(copy.delete()).catch((err) => console.error(`${MODULE_ID} | vault: undo copy`, err));
    return { ok: false, error: "write" };
  }
  return { ok: true, error: null, name: copy.name };
}
