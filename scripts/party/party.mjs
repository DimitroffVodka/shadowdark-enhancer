/** Native Party provider. Persisted identity remains the boolean party flag. */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { normalizeParty, removeMember, mayManage, mayAdd, memberGroup } from "./party-core.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";

const EXTRAS = "shadowdark-extras";
export const PARTY_FLAG = "party";
export const PARTY_DATA = "partyData";
const flags = (actor) => actor?.flags?.[MODULE_ID] ?? {};
const owner = (actor) => !!actor?.testUserPermission?.(game.user, "OWNER");
const readable = (actor) => game.user?.isGM || !!actor?.testUserPermission?.(game.user, "OBSERVER");
export const isNativeParty = (actor) => actor?.type === "NPC" && flags(actor).party === true;
export const isLegacyParty = (actor) => actor?.type === "NPC" && actor.flags?.[EXTRAS]?.isParty === true;
export const isParty = (actor) => isNativeParty(actor) || isLegacyParty(actor) || actor?.type === "Party";
const resolve = (ref) => typeof ref === "object" ? ref : game.actors?.get(ref) ?? game.actors?.contents?.find((a) => a.uuid === ref) ?? null;
const worldMember = (uuid) => game.actors?.contents?.find((a) => a.uuid === uuid) ?? null;
function withLeader(value) {
  const data = normalizeParty(value);
  const eligible = data.members.filter(uuid => ["Player", "NPC"].includes(worldMember(uuid)?.type));
  if (!eligible.includes(data.leaderUuid)) data.leaderUuid = eligible[0] ?? null;
  return data;
}
let selectedUuid = null;

export const Party = {
  list() { return (game.actors?.contents ?? []).filter((a) => (isNativeParty(a) || isLegacyParty(a) || a.type === "Party") && readable(a)); },
  get: resolve,
  canManage(actor) { return (isNativeParty(actor) || isLegacyParty(actor)) && mayManage({ isGM: !!game.user?.isGM, owner: owner(actor) }); },
  selected() {
    const explicit = resolve(selectedUuid);
    if (explicit && readable(explicit) && (isNativeParty(explicit) || isLegacyParty(explicit))) return explicit;
    const controlled = globalThis.canvas?.tokens?.controlled ?? [];
    const chosen = controlled.map((t) => t.actor).filter((a) => (isNativeParty(a) || isLegacyParty(a)) && readable(a));
    if (chosen.length === 1) return chosen[0];
    const choices = this.list().filter((a) => a.type !== "Party");
    return choices.length === 1 ? choices[0] : null;
  },
  select(ref) {
    const actor = resolve(ref);
    if (!actor || !readable(actor) || !(isNativeParty(actor) || isLegacyParty(actor))) return null;
    selectedUuid = actor.uuid; return actor;
  },
  data(ref) {
    const actor = resolve(ref);
    if (!actor || !readable(actor) || !(isNativeParty(actor) || isLegacyParty(actor))) throw new Error("SDE.party.unknownRoster");
    const saved = flags(actor).partyData;
    if (saved !== undefined) return withLeader(saved);
    // Read legacy flags once at adoption. A failed/malformed read must not seed an empty roster.
    // Foundry getFlag refuses scopes of inactive modules, even for persisted data.
    const legacy = actor.flags?.[EXTRAS]?.members;
    if (legacy !== undefined && !Array.isArray(legacy)) throw new Error("SDE.party.unknownRoster");
    return withLeader({ members: (legacy ?? []).map((u) => game.actors?.get(u)?.uuid ?? (String(u).includes(".") ? u : `Actor.${u}`)) });
  },
  members(ref, { charactersOnly = false } = {}) {
    const members = this.data(ref).members;
    return charactersOnly ? members.filter((u) => worldMember(u)?.system?.isPC) : members;
  },
  rows(ref) {
    return this.members(ref).map((uuid) => {
      const actor = worldMember(uuid);
      const visible = actor && readable(actor);
      return { uuid, actor: visible ? actor : null, group: visible ? memberGroup(actor.type) ?? "missing" : "missing" };
    });
  },
  async adopt(ref) {
    const actor = resolve(ref);
    if (!this.canManage(actor)) throw new Error("SDE.party.noPermission");
    const data = this.data(actor);
    if (flags(actor).partyData === undefined) await replaceModuleFlag(actor, PARTY_DATA, data, { [`flags.${MODULE_ID}.${PARTY_FLAG}`]: true });
    return actor;
  },
  async add(ref, uuid) {
    const actor = resolve(ref), member = worldMember(uuid);
    if (!this.canManage(actor)) throw new Error("SDE.party.noPermission");
    const data = this.data(actor);
    if (!member || isNativeParty(member) || isLegacyParty(member) || !mayAdd({ isGM: !!game.user?.isGM, partyOwner: owner(actor), actorOwner: owner(member), member: data.members.includes(uuid), type: member.type })) throw new Error("SDE.party.noPermission");
    await this.adopt(actor);
    return replaceModuleFlag(actor, PARTY_DATA, normalizeParty({ ...data, members: [...data.members, uuid] }));
  },
  async remove(ref, uuid) {
    const actor = resolve(ref);
    if (!this.canManage(actor)) throw new Error("SDE.party.noPermission");
    const data = this.data(actor);
    await this.adopt(actor);
    return replaceModuleFlag(actor, PARTY_DATA, removeMember(data, uuid));
  },
  async create() {
    if (!game.user?.isGM) throw new Error("SDE.party.noPermission");
    return Actor.create({ name: game.i18n.localize("SDE.overland.party.name"), type: "NPC", img: "icons/environment/people/group.webp", flags: { [MODULE_ID]: { party: true, partyData: normalizeParty() } } });
  },
};

/**
 * The roster rule `add` follows (mayAdd: a player adds only an actor they own) is checked on the player's own
 * client, and a player who owns the party can write its flag directly. Everything the GM runs from the roster —
 * Deploy and Gather, camping, overland, quest rewards, the party light — trusts it. So the active GM re-checks every
 * roster a player writes: a member that player could not have added (not theirs, and not already on the roster
 * the GM last saw) is taken off again.
 * ponytail: the "last seen" roster is in memory, seeded on ready; a roster written while no GM is online is
 * accepted as found. A per-party flag only a GM writes would close that, if it ever matters.
 */
export function registerPartyRosterGuard() {
  const seen = new Map();   // party actor id -> Set of member uuids the GM has accepted
  const remember = (actor) => seen.set(actor.id, new Set(Party.data(actor).members));
  Hooks.once("ready", () => { for (const a of game.actors?.contents ?? []) if (isNativeParty(a) || isLegacyParty(a)) remember(a); });
  Hooks.on("updateActor", async (actor, changes, _options, userId) => {
    if (!isNativeParty(actor) || changes?.flags?.[MODULE_ID]?.[PARTY_DATA] === undefined || !isActiveGM()) return;
    const user = game.users?.get(userId);
    const before = seen.get(actor.id) ?? new Set();
    const data = Party.data(actor);
    const forged = user && !user.isGM
      ? data.members.filter((uuid) => !before.has(uuid) && !worldMember(uuid)?.testUserPermission?.(user, "OWNER"))
      : [];
    if (!forged.length) { remember(actor); return; }
    const kept = forged.reduce((d, uuid) => removeMember(d, uuid), data);
    seen.set(actor.id, new Set(kept.members));
    await replaceModuleFlag(actor, PARTY_DATA, kept);
  });
}
