import { MODULE_ID } from "../shared/module-id.mjs";
import { registerQuery, refuseQuery, relayToGM } from "../shared/gm-relay.mjs";
import { Party, isParty } from "./party.mjs";

const t = (key) => game.i18n.localize(key);

export const PARTY_GIVE_QUERY = `${MODULE_ID}.partyGive`;

// A double-click sends two queries, and the item still exists until the first one's delete lands.
const moving = new Set();

/** Move a party item, its whole stack, onto one of the party's characters. Runs on a GM's client: a player cannot write to a sheet they do not own. */
export async function moveItem(party, itemId, uuid) {
  const item = party.items.get(itemId), target = fromUuidSync(uuid);
  if (moving.has(item)) return { ok: false };   // not an error: the first click is doing it
  if (!item || target?.type !== "Player" || !Party.data(party).members.includes(uuid)) return { ok: false, error: t("SDE.party.item.giveRefused") };
  moving.add(item);
  try {
    const data = item.toObject(); delete data._id;
    await target.createEmbeddedDocuments("Item", [data]);
    await item.delete();
    return { ok: true, item: item.name, name: target.name };
  } finally { moving.delete(item); }
}

/** The GM's side of a player's Give: the sender must own the party, and the party must hold the item. */
export function handleGiveQuery(data, user) {
  const party = game.actors.get(data?.partyId);
  if (!isParty(party) || !(user?.isGM || party.testUserPermission(user, "OWNER"))) return { ok: false, error: t("SDE.shared.relay.notOwner") };
  return moveItem(party, data.itemId, data.uuid);
}

/** A GM moves the item here; a player asks the GM's client to. Resolves true when the item moved. */
export async function giveItem(party, itemId, uuid) {
  if (game.user.isGM) return (await moveItem(party, itemId, uuid)).ok;
  return relayToGM(PARTY_GIVE_QUERY, { partyId: party.id, itemId, uuid }, { label: t("SDE.party.item.giveLabel") });
}

export function registerPartyGive() {
  registerQuery(PARTY_GIVE_QUERY, (data, { user } = {}) => refuseQuery(user, t("SDE.party.item.giveLabel")) ?? handleGiveQuery(data, user));
}
