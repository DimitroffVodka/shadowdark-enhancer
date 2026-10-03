/** Native Party roster rules. No Foundry globals or implicit enrollment. */
export const PARTY_VERSION = 1;
export function normalizeParty(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (value.version !== undefined && value.version !== PARTY_VERSION)
    || (value.members !== undefined && !Array.isArray(value.members))) throw new Error("Unknown party roster");
  const members = [...new Set((value.members ?? []).filter((u) => typeof u === "string" && u.length))];
  const slots = [], occupied = new Set(), assigned = new Set();
  for (const slot of value.formation?.slots ?? []) {
    const { memberUuid, col, row } = slot;
    const key = `${col},${row}`;
    if (!members.includes(memberUuid) || !Number.isInteger(col) || !Number.isInteger(row) || occupied.has(key) || assigned.has(memberUuid)) continue;
    slots.push({ memberUuid, col, row }); occupied.add(key); assigned.add(memberUuid);
  }
  return { version: PARTY_VERSION, members, leaderUuid: members.includes(value.leaderUuid) ? value.leaderUuid : members[0] ?? null,
    followLeader: value.followLeader !== false, includeMounts: value.includeMounts === true, formation: { ...value.formation, slots } };
}
export function removeMember(data, uuid) {
  return normalizeParty({ ...data, members: data.members.filter((u) => u !== uuid) });
}
export const mayManage = ({ isGM = false, owner = false } = {}) => isGM || owner;
export const memberGroup = (type) => ({ Player: "characters", NPC: "hirelings", "shadowdark-enhancer.mount": "mounts" })[type] ?? null;
export const mayAdd = ({ isGM = false, partyOwner = false, actorOwner = false, member = false, type } = {}) =>
  mayManage({ isGM, owner: partyOwner }) && !!memberGroup(type) && (isGM || actorOwner || member);
/** Input must already be permission-filtered Quests.list() summaries. */
export function scopedQuests(quests, partyUuid, members) {
  const seen = new Set();
  return quests.filter((q) => {
    if (seen.has(q.uuid) || !(q.party === partyUuid || q.characters?.some((u) => members.includes(u)))) return false;
    seen.add(q.uuid); return true;
  });
}
