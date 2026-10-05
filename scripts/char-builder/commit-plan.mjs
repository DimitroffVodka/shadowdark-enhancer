import { ABILITY_ORDER } from "./constants.mjs";
import { coinsAfterGear } from "./commit.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { levelUpTalent } from "./level-up.mjs";

/** An item's quantity; a stack at 0 is 0, only a missing value reads 1. */
const qtyOf = (item) => (Number.isFinite(Number(item.system?.quantity)) ? Number(item.system.quantity) : 1);

/**
 * The merge-aware commit planner: what Finish would change on an EXISTING actor.
 * Pure (plain data in, plain data out, no Foundry globals) and not wired yet;
 * it is the trust boundary for real characters, so it stays small and total.
 *
 * Three inputs:
 *   B = `existing.baseline` and its row lists, frozen when the builder opened
 *   D = the builder state at Finish
 *   L = the LIVE actor at Finish: `{ source: actor._source, items: [item source] }`
 * INTENT = D against B (what the user changed). The plan is INTENT against L:
 * nothing is written for a key or row the user did not touch, even when L has
 * drifted since open. Where the user did touch a key and L moved off B, a drift
 * line is returned so the dry-run dialog can say so; the user's change wins.
 *
 * ONE FINISH PER BASELINE. A plan is measured from the baseline the builder
 * opened with, so it is only right for the first Finish. After `applyPlan`
 * returns (complete or not) the caller discards `existing` and the builder state
 * and re-hydrates from the LIVE actor: a fresh baseline and a fresh sessionId.
 * Nothing survives across Finishes, and a quantity edit on a row an earlier
 * Finish created is out of contract.
 *
 * Inside ONE attempt the plan is idempotent: a created row's marker is
 * `${sessionId}:${row}`, and a live item carrying it counts as already created,
 * so re-planning from the live actor with the same builder state (after a write
 * that rejected after saving, or a partial failure) does only what remains.
 *
 * Item identity is the embedded item id, never the compendium uuid. Deletes are
 * only ids that were hydrated AND removed by the user AND still exist, and are
 * never a kept id; a violation throws rather than deleting.
 *
 * @returns {{
 *   system: object, name: string|null, art: {portrait?: string, token?: string},
 *   creates: object[], updates: object[], deletes: string[], kept: object[],
 *   drift: object[], summary: {counts: object, lines: object[]}
 * }}  `system` holds dotted paths ready for one `actor.update`. `creates` are
 *   descriptors `{ rowId, kind: "gear"|"spell"|"trinket", uuid?, name, qty? }`
 *   the executor resolves against the compendium. `summary` is structured (no
 *   English): the dialog localizes the line kinds.
 */
export function planCommit(existing, state, live) {
  if (!existing?.baseline) throw new Error("planCommit: no baseline, this builder is not editing an actor");
  if (!live?.source) throw new Error("planCommit: the actor is gone");

  const B = existing.baseline;
  const Ls = live.source.system ?? {};
  const system = {};
  const drift = [];
  const lines = [];

  const uuid = (v) => v || null;
  /** True when the user changed `key`; records drift when live also moved. */
  const changed = (key, b, d, l) => {
    if (b === d) return false;
    if (l !== b) drift.push({ key, baseline: b, live: l, intended: d });
    lines.push({ kind: "set", key, from: b, to: d });
    return true;
  };

  // --- system keys (base values only, dotted paths, changed keys only) ---
  for (const k of ABILITY_ORDER) {
    // Foundry stores an integer of 0 or more: anything else would never read back equal.
    const raw = Number(state.stats?.values?.[k]);
    const d = Math.max(0, Math.round(raw));
    if (Number.isFinite(raw) && changed(`abilities.${k}`, B.abilities[k], d, Number(Ls.abilities?.[k]?.value))) {
      system[`system.abilities.${k}.value`] = d;
    }
  }
  if (state.alignment && changed("alignment", B.alignment, state.alignment, Ls.alignment)) {
    system["system.alignment"] = state.alignment;
  }
  for (const k of ["background", "deity"]) {
    const d = uuid(state[k]?.uuid);
    // null, not "": a nullable UUID field stores null for a cleared value, so the read-back agrees.
    if (changed(k, uuid(B[k]), d, uuid(Ls[k]))) system[`system.${k}`] = d;
  }
  // ancestry, class and patron are locked in v1: never written, an unresolved
  // uuid stays verbatim.

  // Level up, ONE level (#168 P7): the level, the base hit point maximum and the XP
  // left, measured from the LIVE actor. If the live level is no longer the one the
  // builder opened at, the whole level-up is dropped and reported as drift: the new
  // level's talent and spells would otherwise land on the wrong level.
  const lu = state.levelUp;
  let levelUpOn = false;
  const talentCreates = [];
  if (lu) {
    const liveLevel = Number(Ls.level?.value) || 0;
    if (liveLevel !== lu.from) {
      drift.push({ key: "level", baseline: lu.from, live: liveLevel, intended: lu.to });
    } else {
      levelUpOn = true;
      system["system.level.value"] = lu.to;
      lines.push({ kind: "set", key: "level", from: lu.from, to: lu.to });
      // Never lowers: a missing or negative die adds nothing.
      const gain = Math.max(0, hpLevelUpGain(lu.dice));
      const liveMax = Number(Ls.attributes?.hp?.max) || 0;
      if (gain > 0) {
        system["system.attributes.hp.max"] = liveMax + gain;
        // The sheet shows value/max: current HP rises by the same gain (clamped to the new max),
        // like the system's own level-up, so a hurt character stays as hurt as before.
        const liveHp = Number(Ls.attributes?.hp?.value) || 0;
        system["system.attributes.hp.value"] = Math.min(liveMax + gain, liveHp + gain);
        lines.push({ kind: "set", key: "hpMax", from: liveMax, to: liveMax + gain });
      }
      const liveXp = Number(Ls.level?.xp) || 0;
      const xp = xpAfterLevelUp(liveXp, lu.from, lu.to);
      if (xp !== liveXp) {
        system["system.level.xp"] = xp;
        lines.push({ kind: "set", key: "xp", from: liveXp, to: xp });
      }
      const t = levelUpTalent(state);
      if (t) talentCreates.push({ rowId: `${state.existing.sessionId ?? ""}:levelup-talent`, kind: "talent", uuid: t.uuid, name: t.name, choice: t.choice, level: lu.to });
    }
  }

  // Coins: copper, and only on a real change (25 sp must not become 2 gp 5 sp).
  const c = coinsAfterGear(state);
  const dCp = c.gp * 100 + c.sp * 10 + c.cp;
  const lc = Ls.coins ?? {};
  const lCp = (lc.gp || 0) * 100 + (lc.sp || 0) * 10 + (lc.cp || 0);
  if (changed("coins", B.coinsCp, dCp, lCp)) {
    system["system.coins.gp"] = c.gp;
    system["system.coins.sp"] = c.sp;
    system["system.coins.cp"] = c.cp;
  }

  // Languages: a uuid set diff applied to the LIVE list.
  const dLang = new Set(state.languages ?? []);
  const bLang = new Set(B.languages ?? []);
  const add = [...dLang].filter((u) => !bLang.has(u));
  const remove = [...bLang].filter((u) => !dLang.has(u));
  if (add.length || remove.length) {
    const cur = Ls.languages ?? [];
    const next = [...new Set([...cur.filter((u) => !remove.includes(u)), ...add])];
    if (next.length !== cur.length || next.some((u, i) => u !== cur[i])) {
      system["system.languages"] = next;
      lines.push({ kind: "languages", add, remove });
    }
  }

  // Name (blank never clears) and art (only a set slot that differs).
  // Trimmed the way the actor's name field stores it, so the read-back agrees.
  let name = null;
  const dName = String(state.name ?? "").trim();
  if (dName && changed("name", B.name, dName, live.source.name)) name = dName;
  const art = {};
  for (const slot of ["portrait", "token"]) {
    const d = state.art?.[slot];
    if (d && d !== B.art?.[slot]) {
      art[slot] = d;
      lines.push({ kind: "art", slot });
    }
  }

  // --- item rows, by embedded id ---
  const liveItems = new Map(live.items.map((i) => [i._id, i]));
  const keptIds = new Set((existing.kept ?? []).map((k) => k.id).filter(Boolean));
  const bGear = new Map((existing.gearRows ?? []).map((r) => [r.itemId, r]));
  const bSpells = new Map((existing.spellRows ?? []).map((r) => [r.itemId, r]));
  const liveMarkers = new Set(live.items.map((i) => i.flags?.[MODULE_ID]?.builderRow).filter(Boolean));

  const dGear = state.gear ?? [];
  // A dropped level-up (drift) creates none of its new spells either.
  const dSpells = (state.spells ?? []).filter((s) => s.itemId || !lu || levelUpOn);
  // A row the builder still shows is held, whatever its quantity (a stack spent
  // to 0 on the sheet is still an owned row); the cart drops a row taken to 0.
  const stillHeld = new Set([...dGear, ...dSpells].map((r) => r.itemId).filter(Boolean));

  // Baseline rows: a removal is a delete by id, a quantity change an update by id.
  const deletes = [];
  for (const [id, row] of [...bGear, ...bSpells]) {
    if (stillHeld.has(id) || !liveItems.has(id)) continue;
    deletes.push(id);
    lines.push({ kind: "delete", id, name: row.name });
  }
  const updates = [];
  for (const g of dGear) {
    const base = bGear.get(g.itemId)?.qty;
    const q = Number(g.qty);
    const l = liveItems.get(g.itemId);
    if (base == null || !l || !(q >= 0) || q === base) continue;
    const lq = qtyOf(l);
    if (lq === q) continue;
    if (lq !== base) drift.push({ key: `quantity:${g.itemId}`, baseline: base, live: lq, intended: q });
    updates.push({ _id: g.itemId, "system.quantity": q });
    lines.push({ kind: "quantity", id: g.itemId, name: g.name, from: base, to: q });
  }

  // New rows (no itemId): created unless a live item already carries this
  // attempt's marker. A Crawling Kit is one row (one marker on every item it
  // unpacks to, `qty` kits).
  const sid = existing.sessionId ?? "";
  const wanted = [];
  const nth = new Map();
  for (const g of dGear) {
    if (g.itemId) continue;
    const n = (nth.get(g.uuid) ?? 0) + 1;
    nth.set(g.uuid, n);
    const qty = Number(g.qty);
    if (qty >= 1) wanted.push({ rowId: `${sid}:${g.rowId || `${g.uuid}#${n}`}`, kind: "gear", uuid: g.uuid, name: g.name, qty });
  }
  for (const s of dSpells) {
    if (!s.itemId && s.uuid) wanted.push({ rowId: `${sid}:spell:${s.uuid}`, kind: "spell", uuid: s.uuid, name: s.name });
  }
  wanted.push(...talentCreates);
  const trinket = String(state.trinket ?? "").trim();
  if (trinket && trinket !== (B.trinket ?? "")) wanted.push({ rowId: `${sid}:trinket:${trinket}`, kind: "trinket", name: trinket });
  const creates = wanted.filter((w) => !liveMarkers.has(w.rowId));
  for (const cr of creates) lines.push({ kind: "create", name: cr.name, qty: cr.qty ?? 1 });

  // --- invariants: fail loudly rather than delete something we should not ---
  for (const id of deletes) {
    if (!bGear.has(id) && !bSpells.has(id)) throw new Error(`planCommit: delete ${id} was not hydrated`);
    if (keptIds.has(id)) throw new Error(`planCommit: kept item ${id} is in the deletes`);
    if (!liveItems.has(id)) throw new Error(`planCommit: delete ${id} is not on the actor`);
  }
  for (const u of updates) {
    if (keptIds.has(u._id)) throw new Error(`planCommit: kept item ${u._id} is in the updates`);
    if (deletes.includes(u._id)) throw new Error(`planCommit: ${u._id} is both updated and deleted`);
  }

  const kept = (existing.kept ?? []).map((k) => ({ ...k }));
  return {
    system, name, art, creates, updates, deletes, kept, drift,
    summary: {
      counts: {
        system: Object.keys(system).length + (name ? 1 : 0) + Object.keys(art).length,
        creates: creates.length, updates: updates.length, deletes: deletes.length,
        kept: kept.length, drift: drift.length,
      },
      lines,
    },
  };
}

/** True when the plan would write nothing: skip applyPlan then. */
export function planIsEmpty(plan) {
  return !Object.keys(plan.system).length && !plan.name && !Object.keys(plan.art).length
    && !plan.creates.length && !plan.updates.length && !plan.deletes.length;
}

/** HP a level-up adds to the BASE max: the dice summed, no CON (the system's rule). */
export function hpLevelUpGain(dice) {
  return (dice ?? []).reduce((sum, d) => sum + (Number(d) || 0), 0);
}

/**
 * XP left after gaining levels: each level crossed costs level x 10 and the rest
 * carries over, floored at 0 (the system's Level Up app; level 0 carries none).
 */
export function xpAfterLevelUp(xp, fromLevel, toLevel) {
  if (fromLevel < 1) return 0;
  let left = Number(xp) || 0;
  for (let lvl = fromLevel; lvl < toLevel; lvl++) left -= lvl * 10;
  return Math.max(0, left);
}
