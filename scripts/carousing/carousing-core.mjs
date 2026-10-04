/** Native basic carousing: imported/GM-authored data only; no bundled outcomes. */
import { toCopper } from "../shared/coins.mjs";
const cells = row => String(row.description || row.name || row.text || "").replace(/<[^>]*>/g, "").split(/\s*\|\s*/);
export function eventTiers(rows) {
  return rows.flatMap(row => {
    const c = cells(row), cost = Number(c[0]?.replace(/,|\s*gp\s*/gi, "")), bonus = Number(c[2]);
    return c.length === 3 && Number.isFinite(cost) && cost > 0 && Number.isInteger(bonus) && c[1] ? [{ id: row.id ?? row._id, cost, bonus, description: c[1] }] : [];
  });
}
export function outcomeRows(rows) {
  return rows.flatMap(row => {
    const c = cells(row), range = row.range;
    return c[0]?.trim() && range?.length === 2 && range.every(Number.isFinite) && range[0] <= range[1] ? [{ range: [...range], description: c[0], benefit: c.slice(1).join(" | ") }] : [];
  });
}
export function outcomeAt(total, rows) {
  if (!rows.length) return;
  const n = Math.max(Math.min(...rows.map(r => r.range[0])), Math.min(Math.max(...rows.map(r => r.range[1])), total));
  return rows.find(r => r.range[0] <= n && r.range[1] >= n);
}
export function outcomeEffects(description = "", benefit = "") {
  // Only a small, explicit reward grammar is automated. Custom, conditional and
  // negated prose stays in the saved result for GM adjudication, not a reward.
  let xp = 0, luck = 0;
  for (const field of [description, benefit]) {
    if (/\b(?:if|unless|when|until|after|before|may|might|could|would|not|no|never|without|instead|or)\b|n't\b/i.test(field)) continue;
    let gain = false;
    for (const clause of field.split(/\s+and\s+|[.;]/i)) {
      const reward = clause.trim().match(/^(?:(?:you\s+)?(?:gain|earn|receive)\s+|\+\s*)(\d+|an?|one)\s+(XP|luck\s+tokens?)$/i);
      const shared = gain && clause.trim().match(/^(\d+|an?|one)\s+(XP|luck\s+tokens?)$/i);
      const match = reward || shared;
      gain = !!match;
      if (!match) continue;
      const amount = /^\d+$/.test(match[1]) ? Number(match[1]) : 1;
      if (match[2].toLowerCase() === "xp") xp += amount;
      else luck += amount;
    }
  }
  const text = `${description} ${benefit}`;
  const renown = text.match(/([+-]\s*\d+)\s+renown\b/i) ?? text.match(/\b(gain|lose)\s+(\d+)\s+renown\b/i);
  // Losses — a percentage of wealth included — stay prose in the saved result:
  // docs/wiki/Carousing.md keeps them visible GM actions, never automation.
  return { xp, luck, renown: renown ? (renown[2] ? Number(renown[2]) * (renown[1].toLowerCase() === "lose" ? -1 : 1) : Number(renown[1].replace(/\s/g, ""))) : 0 };
}
/** A group total in whole gp split between `count` people; the remainder goes one coin at a time to the first in list order. */
export function splitCost(total, count) {
  if (!(count > 0)) return [];
  const base = Math.floor(total / count), extra = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}
export function preflight({ participants, tierId, tiers, outcomes, limit = Infinity, holiday = null, downtime = false, now = Date.now() }) {
  const fail = error => ({ ok: false, error });
  if (downtime) return fail("SDE.carousing.downtime");
  if (!tiers.length || !outcomes.length) return fail("SDE.carousing.tablesMissing");
  if (!participants.length || !participants.some(p => p.participate)) return fail("SDE.carousing.noParticipants");
  if (participants.some(p => !p.confirmed)) return fail("SDE.carousing.confirm");
  const tier = tiers.find(t => t.id === tierId); if (!tier) return fail("SDE.carousing.tablesMissing");
  if (tier.cost > limit) return fail("SDE.carousing.limit");
  const joining = participants.filter(p => p.participate), shares = splitCost(tier.cost, joining.length), chosen = [];
  for (const [i, p] of joining.entries()) {
    if (p.lastAt != null && now - p.lastAt < 14 * 86400000) return fail("SDE.carousing.cooldown");
    if (toCopper(p.coins) < shares[i] * 100) return fail("SDE.carousing.funds");
    const bonus = tier.bonus + (holiday?.carousing?.eventBonus ?? 0) + (p.renownBonus ?? 0);
    for (let die = 1; die <= 8; die++) if (!outcomeAt(die + bonus, outcomes)) return fail("SDE.carousing.tablesMissing");
    chosen.push({ ...p, cost: shares[i], bonus, tier });
  }
  return { ok: true, participants: chosen };
}
export function recapNight(night) {
  if (night.historyOnly) return null;
  return { logId: night.logId, date: night.date, mode: "native", tierCost: night.participants.reduce((s, p) => s + p.cost, 0), entries: night.participants.map(p => {
    const r = night.results[p.actorId];
    return { participantId: p.actorId, actorName: p.name, player: p.player, mode: "native", roll: r.total, outcome: r.description, xp: r.effects.xp, cost: p.cost, benefits: r.benefit ? [{ text: r.benefit, renownDelta: 0 }] : [], mishaps: [], renownDelta: r.effects.renown, appliedState: "applied", applied: "" };
  }) };
}
