// What route.mjs imports, for auto-journey-route.test.mjs (which points route.mjs's imports here, all but the
// pure overland-state-core.mjs). The world: a one-row hex strip, hexes i = 0..20, every hex costs 1 unless
// `cfg.closed` has it. The travel state is `S`; the relays log what they were asked in `log`.
export const MODULE_ID = "shadowdark-enhancer";
export const OVERLAND_CHANGED = "sde.overlandChanged";
export const CrawlState = { isOverland: true, HOOK_CHANGED: "sde.crawlChanged" };
export const isHexMapScene = () => true;
export const hexReader = () => (o) => (o.i >= 0 && o.i <= 20 && o.j === 0 ? { num: o.i, terrain: "plains", region: "R" } : null);
export const ownsHexFog = () => false;
export const hexDisclosure = () => null;
export const readPass = () => null;
export const esc = (s) => String(s);
export const L = (k, d) => (d ? `${k} ${JSON.stringify(d)}` : k);
export const AUTO_BLOCKED = {};
export const campOf = () => null;
export const travelParty = () => null;
export const chainLeadMs = () => 0;
export const fastTravel = async () => ({ ok: true });

export const cfg = {};
export const log = {};
export const S = {};
const fresh = () => ({
  auto: true, autoGoal: { i: 5, j: 0 }, day: null, pending: null, encounter: null, camp: null,
  stormy: false, harsh: false, hexesLeft: 0, budget: 0, spent: 0, checks: [], hex: { num: 0 }, tokenUuid: "Scene.s.Token.t",
});
/** A new world for each test. */
export function reset(state = {}) {
  for (const o of [cfg, log, S]) for (const k of Object.keys(o)) delete o[k];
  Object.assign(cfg, { closed: new Set(), blocked: null, camps: 0 });
  Object.assign(log, { autoStartDay: 0, setAutoGoal: [], travelBlocked: 0 });
  Object.assign(S, fresh(), state);
}
reset();

export const overlandState = () => structuredClone(S);
export const travelStepCost = () => (hex) => (cfg.closed.has(hex?.num) ? Infinity : 1);
/** `cfg.blocked`: one answer, or a list answered in turn (its last answer repeats). */
export const travelBlocked = async () => { log.travelBlocked++; return Array.isArray(cfg.blocked) ? (cfg.blocked.length > 1 ? cfg.blocked.shift() : cfg.blocked[0]) : cfg.blocked; };
export const AUTO_WAIT_DAYS = 14;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
/** The active GM's Start day: openDay is committed (the hook fires), THEN the day's card and catch-up check take a round trip. */
export async function autoStartDay() {
  log.autoStartDay++;
  await tick(2);
  if (cfg.startError) throw new Error(cfg.startError);
  if (S.day === null) { Object.assign(S, { day: 1, budget: 4, spent: 0, hexesLeft: 4 }); globalThis.Hooks.callAll(OVERLAND_CHANGED, structuredClone(S)); }
  await tick(15);
  return { ok: true, encounter: false };
}
export async function setAutoGoal(goal) { log.setAutoGoal.push(goal); await tick(1); S.autoGoal = goal; return { ok: true }; }
export async function travelSettled() { await tick(3); }
/** A camp fails unless `cfg.campOk`, when it ends the day and its dawn opens the next. */
export async function makeCamp() {
  cfg.camps++;
  if (!cfg.campOk) return { ok: false, error: "no camp in this world" };
  Object.assign(S, { day: (S.day ?? 0) + 1, budget: 4, spent: 0, hexesLeft: 4 });
  globalThis.Hooks.callAll(OVERLAND_CHANGED, structuredClone(S));
  return { ok: true, stopped: false };
}
