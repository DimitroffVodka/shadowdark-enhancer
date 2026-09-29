import { ABILITY_ORDER } from "./constants.mjs";
import { coinsAfterGear } from "./commit.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";

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
    const d = Number(state.stats?.values?.[k]);
    if (Number.isFinite(d) && changed(`abilities.${k}`, B.abilities[k], d, Number(Ls.abilities?.[k]?.value))) {
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
    if (d && d !== B.art?.[slot]) { art[slot] = d; lines.push({ kind: "art", slot }); }
  }

  // --- item rows, by embedded id ---
  const liveItems = new Map(live.items.map((i) => [i._id, i]));
  const keptIds = new Set((existing.kept ?? []).map((k) => k.id).filter(Boolean));
  const bGear = new Map((existing.gearRows ?? []).map((r) => [r.itemId, r]));
  const bSpells = new Map((existing.spellRows ?? []).map((r) => [r.itemId, r]));
  const markerOf = (i) => i.flags?.[MODULE_ID]?.builderRow;
  const liveMarkers = new Set(live.items.map(markerOf).filter(Boolean));

  const dGear = state.gear ?? [];
  const dSpells = state.spells ?? [];
  const stillHeld = new Set([
    ...dGear.filter((g) => g.itemId && Number(g.qty) >= 1).map((g) => g.itemId),
    ...dSpells.map((s) => s.itemId).filter(Boolean),
  ]);

  const deletes = [];
  for (const [id, row] of [...bGear, ...bSpells]) {
    if (stillHeld.has(id) || !liveItems.has(id)) continue;
    deletes.push(id);
    lines.push({ kind: "delete", id, name: row.name });
  }

  const updates = [];
  for (const g of dGear) {
    const b = g.itemId && bGear.get(g.itemId);
    const q = Number(g.qty);
    if (!b || !(q >= 1) || q === b.qty) continue;
    const l = liveItems.get(g.itemId);
    if (!l) continue;
    const lq = Number(l.system?.quantity) || 1;
    if (lq === q) continue;
    if (lq !== b.qty) drift.push({ key: `quantity:${g.itemId}`, baseline: b.qty, live: lq, intended: q });
    updates.push({ _id: g.itemId, "system.quantity": q });
    lines.push({ kind: "quantity", id: g.itemId, name: b.name, from: b.qty, to: q });
  }

  // Created rows. Every marker is namespaced by this builder session, so a
  // marker left by an earlier session can never be mistaken for this one's, and
  // every row this session made (gear, spell, trinket) is tracked the same way.
  const sid = existing.sessionId ?? "";
  const mine = new Set(existing.createdRowIds ?? []);
  const wanted = [];
  const nth = new Map();
  for (const g of dGear) {
    if (g.itemId) continue;
    const n = (nth.get(g.uuid) ?? 0) + 1;
    nth.set(g.uuid, n);
    wanted.push({ rowId: `${sid}:${g.rowId || `${g.uuid}#${n}`}`, kind: "gear", uuid: g.uuid, name: g.name, qty: Number(g.qty) || 1 });
  }
  for (const s of dSpells) {
    if (!s.itemId && s.uuid) wanted.push({ rowId: `${sid}:spell:${s.uuid}`, kind: "spell", uuid: s.uuid, name: s.name });
  }
  const trinket = String(state.trinket ?? "").trim();
  if (trinket && trinket !== (B.trinket ?? "")) wanted.push({ rowId: `${sid}:trinket:${trinket}`, kind: "trinket", name: trinket });
  const wantedIds = new Set(wanted.map((w) => w.rowId));

  // A row this session already made is owned: never granted again (even if it
  // was spent on the sheet since), and deleted only when the user removed it.
  const creates = wanted.filter((w) => !liveMarkers.has(w.rowId) && !mine.has(w.rowId));
  const madeThisSession = new Set();
  for (const i of live.items) {
    const m = markerOf(i);
    if (m && mine.has(m) && m.startsWith(`${sid}:`) && !wantedIds.has(m)) {
      deletes.push(i._id);
      madeThisSession.add(i._id);
      lines.push({ kind: "delete", id: i._id, name: i.name });
    }
  }
  for (const cr of creates) lines.push({ kind: "create", name: cr.name, qty: cr.qty ?? 1 });

  // --- invariants: fail loudly rather than delete something we should not ---
  for (const id of deletes) {
    if (!bGear.has(id) && !bSpells.has(id) && !madeThisSession.has(id)) {
      throw new Error(`planCommit: delete ${id} was neither hydrated nor made by this session`);
    }
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

/** True when the plan would write nothing at all. */
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
