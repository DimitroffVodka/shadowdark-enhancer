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
/**
 * Expanded carousing (Cursed Scroll #6, Western Reaches): an outcome row is a matrix line, not a sentence --
 * `Mishaps | Benefits | % modifier | XP`, a dash meaning none. The d100 Benefit and Mishap tables it sends you to are plain rows.
 */
const count = cell => /^[-–—−]*$/.test(cell.trim()) ? 0 : Number(cell.trim().replace(/%$/, "").replace(/−/g, "-"));
export function matrixRows(rows) {
  return rows.flatMap(row => {
    const c = cells(row), range = row.range;
    if (c.length !== 4 || range?.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1]) return [];
    const [mishapRolls, benefitRolls, modifier, xp] = c.map(count);
    return [mishapRolls, benefitRolls, modifier, xp].every(Number.isInteger) && mishapRolls >= 0 && benefitRolls >= 0 ? [{ range: [...range], mishapRolls, benefitRolls, modifier, xp }] : [];
  });
}
export const d100Rows = rows => outcomeRows(rows).map(r => ({ range: r.range, text: [r.description, r.benefit].filter(Boolean).join(" | ") }));
/** Which tables go together: pick one book's outcome table and its event, benefit and mishap tables follow it. Core is basic carousing. */
export const BOOKS = [
  { outcome: "core-carousing-outcome", event: "core-carousing-event" },
  { outcome: "pgwr-carousing-outcome", event: "pgwr-carousing-event", benefit: "pgwr-carousing-benefit", mishap: "pgwr-carousing-mishap" },
  { outcome: "cs6-carousing-outcome", event: "cs6-carousing-event", benefit: "cs6-benefit", mishap: "cs6-mishap" },
];
/** The Benefit and Mishap tables hold their own "re-roll this as the other one" rows. */
const REROLL_AS_MISHAP = /re-?roll\s+this\s+benefit\s+as\s+a\s+mishap/i, REROLL_AS_BENEFIT = /re-?roll\s+this\s+mishap\s+as\s+a\s+benefit/i;
/** A holiday touches benefit rolls only: advantage (keep the higher of two) and a flat bonus. */
export const d100Formula = (type, holiday = {}) => {
  const h = type === "benefit" ? holiday : {};
  return `${h.benefitAdvantage ? "2d100kh" : "1d100"}${h.benefitBonus ? ` + ${h.benefitBonus}` : ""}`;
};
/**
 * Every benefit and mishap one outcome row calls for, plus a holiday's extra one of each. The row's % modifier shifts each d100,
 * clamped to 1-100; a "re-roll as the other" row rolls again on the other table, at most four times, and lands in that table's list.
 * `roll(type)` returns one die total, so the caller owns the dice.
 */
export async function rollExpanded({ row, benefits, mishaps, roll, holiday = {} }) {
  const found = { benefits: [], mishaps: [] };
  const draw = async kind => {
    let type = kind, entry;
    for (let hop = 0; hop < 4; hop++) {
      const dice = await roll(type), final = Math.max(1, Math.min(100, dice + row.modifier));
      const hit = outcomeAt(final, type === "benefit" ? benefits : mishaps);
      entry = { type, dice, roll: final, text: hit.text };
      if (!(type === "benefit" ? REROLL_AS_MISHAP : REROLL_AS_BENEFIT).test(hit.text)) break;
      type = type === "benefit" ? "mishap" : "benefit";
    }
    found[entry.type === "benefit" ? "benefits" : "mishaps"].push(entry);
  };
  for (let i = 0; i < row.benefitRolls + (holiday.extraBenefit ? 1 : 0); i++) await draw("benefit");
  for (let i = 0; i < row.mishapRolls + (holiday.extraMishap ? 1 : 0); i++) await draw("mishap");
  return found;
}
/** The row's XP plus whatever each rolled benefit or mishap states in the same small grammar basic carousing automates. */
export function expandedEffects(xp, entries) {
  return entries.reduce((sum, e) => { const x = outcomeEffects(e.text); return { xp: sum.xp + x.xp, luck: sum.luck + x.luck, renown: sum.renown + x.renown }; }, { xp, luck: 0, renown: 0 });
}
/** One saved result as the two strings a history line shows. */
export function resultLine(result, xpLabel = n => `${n} XP`) {
  if (result?.mode !== "expanded") return { outcome: result?.description, benefit: result?.benefit };
  return { outcome: xpLabel(result.xp), benefit: [...result.benefits, ...result.mishaps].map(e => e.text).join(" · ") };
}
/** The dropdowns are a hundred RollTables long: the ones with "carousing" in their name come first, each group in name order. */
const isCarousing = row => /carous/i.test(`${row.bare ?? row.name} ${row.manifestId ?? ""}`);
export const carousingFirst = rows => [...rows].sort((a, b) => isCarousing(b) - isCarousing(a) || String(a.name).localeCompare(String(b.name)));
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
  const renown = text.match(/([+-]\s*\d+)\s+renown\b(?!\s+if\b)/i) ?? text.match(/\b(gain|lose)\s+(\d+)\s+renown\b(?!\s+if\b)/i);
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
export function preflight({ participants, tierId, tiers, outcomes, expanded = false, benefits = [], mishaps = [], limit = Infinity, holiday = null, downtime = false, now = Date.now() }) {
  const fail = error => ({ ok: false, error });
  if (downtime) return fail("SDE.carousing.downtime");
  if (!tiers.length || !outcomes.length) return fail("SDE.carousing.tablesMissing");
  if (expanded && ![benefits, mishaps].every(t => t.length && Array.from({ length: 100 }, (_, i) => outcomeAt(i + 1, t)).every(Boolean))) return fail("SDE.carousing.tablesMissing");
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
    const r = night.results[p.actorId], entry = e => ({ text: e.text, roll: e.roll, renownDelta: outcomeEffects(e.text).renown });
    if (r.mode === "expanded") return { participantId: p.actorId, actorName: p.name, player: p.player, mode: "expanded", roll: r.total, outcome: `${r.xp} XP`, xp: r.effects.xp, cost: p.cost, benefits: r.benefits.map(entry), mishaps: r.mishaps.map(entry), renownDelta: r.effects.renown, appliedState: "applied", applied: "" };
    return { participantId: p.actorId, actorName: p.name, player: p.player, mode: "native", roll: r.total, outcome: r.description, xp: r.effects.xp, cost: p.cost, benefits: r.benefit ? [{ text: r.benefit, renownDelta: 0 }] : [], mishaps: [], renownDelta: r.effects.renown, appliedState: "applied", applied: "" };
  }) };
}
