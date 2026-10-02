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
  let wealthPercent = 0;
  for (const field of [description, benefit]) {
    const m = field.match(/(\d+)\s*%\s*of\s+(?:your|their|the)\s+total\s+wealth/i);
    if (m && !/\b(?:gain|earn|win|won|recover|receive|find|found)\w*\b/i.test(field.slice(Math.max(0, m.index - 24), m.index))) wealthPercent = Math.min(100, Number(m[1]));
  }
  return { xp, luck, wealthPercent, renown: renown ? (renown[2] ? Number(renown[2]) * (renown[1].toLowerCase() === "lose" ? -1 : 1) : Number(renown[1].replace(/\s/g, ""))) : 0 };
}
export function holidayFor(holiday, answers = {}) {
  const garb = holiday?.garb ?? [], yes = garb.filter(g => answers[g.key] === true);
  return { admitted: garb.every(g => !g.required || answers[g.key] === true), bonus: (holiday?.carousing?.eventBonus ?? 0) + yes.reduce((s, g) => s + g.modifier, 0), notes: yes.map(g => g.note).filter(Boolean) };
}
export function preflight({ participants, tiers, outcomes, limit = Infinity, holiday = null, downtime = false, now = Date.now() }) {
  const fail = error => ({ ok: false, error });
  if (downtime) return fail("SDE.carousing.downtime");
  if (!tiers.length || !outcomes.length) return fail("SDE.carousing.tablesMissing");
  if (!participants.length || !participants.some(p => p.participate)) return fail("SDE.carousing.noParticipants");
  if (participants.some(p => !p.confirmed)) return fail("SDE.carousing.confirm");
  const chosen = [];
  for (const p of participants.filter(p => p.participate)) {
    const tier = tiers.find(t => t.id === p.tierId); if (!tier) return fail("SDE.carousing.tablesMissing");
    if (tier.cost > limit) return fail("SDE.carousing.limit");
    if (p.lastAt != null && now - p.lastAt < 14 * 86400000) return fail("SDE.carousing.cooldown");
    if (toCopper(p.coins) < tier.cost * 100) return fail("SDE.carousing.funds");
    const h = holidayFor(holiday, p.garb); if (!h.admitted) return fail("SDE.carousing.holidayEntry");
    const bonus = tier.bonus + h.bonus + (p.renownBonus ?? 0);
    for (let die = 1; die <= 8; die++) if (!outcomeAt(die + bonus, outcomes)) return fail("SDE.carousing.tablesMissing");
    chosen.push({ ...p, cost: tier.cost, bonus, tier, holidayNotes: h.notes });
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
