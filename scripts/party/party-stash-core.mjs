/**
 * Party stash: how the shared inventory gets its slots. Pure, so the sheet and
 * the settings window decide the same numbers without a world.
 *
 * Two modes:
 *   free      the party has its own allowance (the legacy partyMaxSlots, else 10)
 *   donated   the capacity is exactly what members reserve on their own sheets
 */
export const STASH_MODES = ["free", "donated"];
export const FREE_STASH_SLOTS = 10;

const slotsOf = (value) => Math.max(0, Math.trunc(Number(value) || 0));

/** Keep only donations that belong to current members, as whole slots, keyed by actor id. */
export function normalizeDonations(value, memberIds = []) {
  const allowed = new Set(memberIds ?? []);
  const out = {};
  for (const [id, raw] of Object.entries(value ?? {})) {
    const slots = slotsOf(raw);
    if (allowed.has(id) && slots) out[id] = slots;
  }
  return out;
}

export const totalDonations = (donations = {}) => Object.values(donations ?? {}).reduce((sum, slots) => sum + slotsOf(slots), 0);

/** The shared inventory's capacity under the current mode. */
export function stashCapacity({ mode = "free", legacyMax = null, donations = {} } = {}) {
  if (mode === "donated") return totalDonations(donations);
  const legacy = Number(legacyMax);
  return legacyMax != null && Number.isFinite(legacy) ? slotsOf(legacy) : FREE_STASH_SLOTS;
}

/**
 * The most a member may reserve. `used` includes any existing stash item, so
 * subtract that reservation before asking how much room the member has.
 */
export function donationLimit({ max = 10, used = 0, stash = 0 } = {}) {
  return Math.max(0, slotsOf(max) - Math.max(0, slotsOf(used) - slotsOf(stash)));
}

/**
 * The next donations after a member asks for `requested` slots.
 * Refuses a reduction that would leave the party carrying more than its
 * capacity; an already-over party may still donate more.
 */
export function planDonation({ donations = {}, memberId, requested = 0, limit = 0, partyUsed = 0, mode = "donated" } = {}) {
  if (mode !== "donated") return { ok: false, reason: "SDE.party.stash.refuse.mode" };
  if (!memberId) return { ok: false, reason: "SDE.party.stash.refuse.member" };
  const current = normalizeDonations(donations, Object.keys(donations ?? {}));
  const before = totalDonations(current);
  const value = Math.min(slotsOf(requested), slotsOf(limit));
  const next = { ...current };
  if (value) next[memberId] = value; else delete next[memberId];
  const capacity = totalDonations(next);
  if (capacity < slotsOf(partyUsed) && capacity < before) {
    return { ok: false, reason: "SDE.party.stash.refuse.inUse", data: { used: slotsOf(partyUsed), slots: capacity } };
  }
  return { ok: true, donations: next, value, capacity };
}
