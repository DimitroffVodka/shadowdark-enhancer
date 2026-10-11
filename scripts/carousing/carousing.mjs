import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { isActiveGM, queryActiveGM, refuseQuery, registerQuery } from "../shared/gm-relay.mjs";
import { Party, isNativeParty } from "../party/party.mjs";
import { PartyXP } from "../party-xp/party-xp.mjs";
import { Renown } from "../renown/renown.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import { advanceOffDuty } from "../time/off-duty.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { holidaysToday } from "../holidays/holidays.mjs";
import { toCopper, spendFromPurse } from "../shared/coins.mjs";
import { eventTiers, outcomeRows, outcomeAt, outcomeEffects, preflight, recapNight } from "./carousing-core.mjs";
const QUERY = `${MODULE_ID}.carousing`;
const own = (a, user) => !!a?.testUserPermission(user, "OWNER");
const actorOf = uuid => game.actors.contents.find(a => a.uuid === uuid);
const flag = (a, key) => a?.flags?.[MODULE_ID]?.[key];
const invalid = (key = "SDE.carousing.invalid") => { throw new Error(key); };
/**
 * Reads share one copy of the stored state until it changes: the clone is memoized on the
 * stored flag's identity and every local write retires it. Writers mutate synchronously up
 * to their save (which retires the memo before the write), a failed write leaves the
 * previous stored state in place, and a fresh clone of it is served again next read.
 */
let revision = 0, memo = null;
export function carousingOf(party) {
  const raw = flag(party, "carousing");
  if (!raw) return { history: [], current: null };
  if (memo?.raw === raw && memo.revision === revision) return memo.state;
  memo = { raw, revision, state: structuredClone(raw) };
  return memo.state;
}
export const carousingOpen = () => game.actors.contents.some(a => isNativeParty(a) && carousingOf(a).current && carousingOf(a).current.phase !== "complete");
const save = (party, state) => { revision += 1; return replaceModuleFlag(party, "carousing", state); };
/** One sweep per table set, refreshed by the table hooks — never once per sheet render. */
let tables = null;
export async function carousingTables() {
  return tables ??= (async () => {
    const rows = (game.tables?.contents ?? []).map(t => ({ uuid: t.uuid, name: t.name, manifestId: flag(t, "manifestId") }));
    for (const pack of game.packs ?? []) {
      if (pack.documentName !== "RollTable") continue;
      for (const e of await pack.getIndex({ fields: [`flags.${MODULE_ID}.manifestId`] })) rows.push({ uuid: e.uuid ?? `Compendium.${pack.collection}.${e._id}`, name: `${pack.metadata.label}: ${e.name}`, manifestId: flag(e, "manifestId") });
    }
    return rows;
  })().catch(error => { tables = null; throw error; });
}
async function tableData(config) {
  const refs = await carousingTables();
  const event = config.event || refs.find(t => t.manifestId === "core-carousing-event")?.uuid;
  const outcome = config.outcome || refs.find(t => t.manifestId === "core-carousing-outcome")?.uuid;
  const load = async uuid => uuid ? fromUuid(uuid).catch(() => null) : null;
  const [e, o] = await Promise.all([load(event), load(outcome)]);
  return { event: event ?? "", outcome: outcome ?? "", tiers: eventTiers(e?.results?.contents ?? []), outcomes: outcomeRows(o?.results?.contents ?? []) };
}
async function context(config) {
  const kind = config.settlement || "none";
  const limit = game.shadowdarkEnhancer.rules.carousingLimit(kind) ?? Infinity;
  const holiday = config.place ? (await holidaysToday({ place: config.place }))[0] ?? null : null;
  return { limit, holiday, downtime: !!(await game.shadowdarkEnhancer.downtime.isOpen()) };
}
async function markActor(actor, night, key, extra = {}) {
  const progress = flag(actor, "carousingProgress") ?? {};
  return replaceModuleFlag(actor, "carousingProgress", { ...progress, [night.logId]: { ...progress[night.logId], [key]: true, at: night.at } }, extra);
}
async function finish(party, state) {
  const night = state.current;
  if (night.historyOnly) invalid();
  if (night.phase === "complete") { await report(party, state); return state; }
  // All recipients and outstanding costs are checked before the first charge.
  for (const p of night.participants) {
    const a = actorOf(p.uuid); if (!a || a.type !== "Player") invalid();
    if (!flag(a, "carousingProgress")?.[night.logId]?.cost && toCopper(a.system.coins) < p.cost * 100) invalid("SDE.carousing.funds");
  }
  for (const p of night.participants) {
    const a = actorOf(p.uuid);
    if (!flag(a, "carousingProgress")?.[night.logId]?.cost) await markActor(a, night, "cost", { "system.coins": spendFromPurse(a.system.coins, p.cost * 100) });
    if (!night.results[p.actorId]) {
      const roll = await new Roll("1d8 + @bonus", { bonus: p.bonus }).evaluate();
      const row = outcomeAt(roll.total, night.outcomes); if (!row) invalid("SDE.carousing.tablesMissing");
      night.results[p.actorId] = { total: roll.total, ...row, effects: outcomeEffects(row.description, row.benefit), applied: false };
      await save(party, state);
    }
  }
  night.phase = "effects"; await save(party, state);
  for (const p of night.participants) {
    const a = actorOf(p.uuid), r = night.results[p.actorId], effects = r.effects;
    if (effects.xp > 0 && !flag(a, "carousingProgress")?.[night.logId]?.xp) {
      const actorIds = [a.id]; if (!actorIds.length) invalid("SDE.carousing.noParticipants");
      if (!await PartyXP.award(effects.xp, { actorIds, label: game.i18n.localize("SDE.carousing.title"), carousingId: night.logId })) invalid();
    }
    if (effects.renown && !flag(a, "carousingProgress")?.[night.logId]?.renown) {
      const awarded = await Renown.award({ actor: a, delta: effects.renown, source: "carousing", chat: false, reason: game.i18n.localize("SDE.carousing.title"), carousingId: night.logId });
      if (!awarded.ok) invalid();
    }
    if (effects.luck && !flag(a, "carousingProgress")?.[night.logId]?.luck) {
      const pulp = game.settings.get("shadowdark", "usePulpMode");
      await markActor(a, night, "luck", pulp ? { "system.luck.remaining": (a.system.luck.remaining ?? 0) + effects.luck } : { "system.luck.available": true });
    }
    r.applied = true; await save(party, state);
  }
  night.phase = "time";
  if (night.until == null) {
    const days = Math.max(1, ...night.participants.map(p => p.tier.bonus + (night.holiday?.carousing?.eventBonus ?? 0)));
    night.until = game.time.worldTime + days * secondsPerDay(game.time.calendar);
  }
  await save(party, state);
  if (game.time.worldTime < night.until) {
    const moved = await advanceOffDuty(night.until - game.time.worldTime, { reason: "carousing" });
    if (!moved.ok) invalid("SDE.carousing.timePending");
  }
  night.phase = "complete";
  if (!state.history.some(h => h.logId === night.logId)) state.history.push(structuredClone(night));
  await save(party, state); await report(party, state); return state;
}
async function report(party, state) {
  try { await SessionRecap.logCarousing(recapNight(state.current)); state.current.reported = true; await save(party, state); }
  catch (error) { console.warn(`${MODULE_ID} | Carousing recap`, error); }
}
// One authority queue covers cross-party actor participation as well as double clicks.
let queue = Promise.resolve();
export function handleCarousing(data, user) {
  const refusal = refuseQuery(user); if (refusal) return Promise.resolve(refusal);
  const run = queue.catch(() => {}).then(async () => {
    try {
      const party = game.actors.get(data.partyId); if (!isNativeParty(party)) invalid();
      const state = carousingOf(party), manager = own(party, user), current = state.current;
      if (data.action === "begin") {
        if (!manager) invalid(); if (current && current.phase !== "complete") return { ok: true, state };
        if (carousingOpen() || (await context(state.config ?? {})).downtime) invalid("SDE.carousing.downtime");
        const config = state.config ?? { settlement: "none", place: "" }, tables = await tableData(config);
        state.current = { logId: foundry.utils.randomID(), phase: "setup", config, ...tables, results: {}, participants: Party.members(party, { charactersOnly: true }).map(uuid => ({ uuid, actorId: actorOf(uuid).id, name: actorOf(uuid).name, confirmed: false, participate: false })) };
        state.current.tierId = tables.tiers[0]?.id ?? "";
        await save(party, state);
      } else if (data.action === "configure") {
        if (!user.isGM || (current && current.phase !== "setup" && current.phase !== "complete")) invalid();
        const config = { ...state.config };
        for (const key of ["event", "outcome", "settlement", "place"]) if (typeof data.config?.[key] === "string") config[key] = data.config[key];
        if (!["none", "village", "town", "city", "city_state"].includes(config.settlement)) invalid();
        state.config = config;
        if (current?.phase === "setup") { Object.assign(current, await tableData(config), { config }); current.tierId = current.tiers[0]?.id ?? ""; for (const p of current.participants) p.confirmed = false; }
        await save(party, state);
      } else if (data.action === "tier") {
        if (!manager || current?.phase !== "setup" || !current.tiers.some(t => t.id === data.tierId)) invalid();
        current.tierId = data.tierId; for (const p of current.participants) p.confirmed = false;
        await save(party, state);
      } else if (data.action === "select") {
        const p = current?.participants.find(p => p.uuid === data.uuid);
        if (current?.phase !== "setup" || !p || !own(actorOf(p.uuid), user)) invalid();
        for (const key of ["participate"]) if (data.patch?.[key] !== undefined) p[key] = data.patch[key];
        p.confirmed = data.confirm === true; p.player = user.name; await save(party, state);
      } else if (data.action === "cancel") {
        if (!manager || current?.phase !== "setup") invalid(); state.current = null; await save(party, state);
      } else if (["start", "resume"].includes(data.action)) {
        if (!manager || !current) invalid();
        if (current.phase === "setup") {
          const fresh = await tableData(current.config);
          if (JSON.stringify(fresh.tiers) !== JSON.stringify(current.tiers) || JSON.stringify(fresh.outcomes) !== JSON.stringify(current.outcomes)) invalid("SDE.carousing.tablesChanged");
          const ctx = await context(current.config), now = Date.now();
          const participants = current.participants.map(p => { const a = actorOf(p.uuid); if (!a) invalid(); return { ...p, coins: a.system.coins, renownBonus: Renown.bonusOf(a), lastAt: Math.max(-Infinity, ...Object.values(flag(a, "carousingProgress") ?? {}).filter(r => r.cost).map(r => r.at)) }; });
          const check = preflight({ ...ctx, tierId: current.tierId ?? current.tiers[0]?.id ?? "", tiers: current.tiers, outcomes: current.outcomes, participants, now }); if (!check.ok) invalid(check.error);
          Object.assign(current, { participants: check.participants, phase: "rolling", at: now, date: new Date(now).toISOString(), holiday: ctx.holiday });
          await save(party, state);
        }
        await finish(party, state);
      } else if (data.action === "importHistory") {
        if (!user.isGM || !Array.isArray(data.entries)) invalid();
        for (const entry of data.entries) if (entry?.logId && !state.history.some(h => h.logId === entry.logId)) state.history.push({ ...entry, historyOnly: true });
        await save(party, state);
      } else invalid();
      return { ok: true, state };
    } catch (error) { console.error(`${MODULE_ID} | Carousing`, error); return { ok: false, error: game.i18n.localize(error.message.startsWith("SDE.") ? error.message : "SDE.carousing.invalid") }; }
  });
  queue = run; return run;
}
export function requestCarousing(party, action, data = {}) {
  const payload = { ...data, partyId: party.id, action };
  return isActiveGM() ? handleCarousing(payload, game.user) : queryActiveGM(QUERY, payload);
}
export function registerCarousing() {
  registerQuery(QUERY, (data, { user }) => handleCarousing(data, user));
  for (const hook of ["createRollTable", "updateRollTable", "deleteRollTable", "updateCompendium"]) Hooks.on(hook, () => { tables = null; });
}
