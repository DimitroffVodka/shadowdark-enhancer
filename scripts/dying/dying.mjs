/**
 * Shadowdark Enhancer — dying, death timers and stabilizing (#181).
 *
 * Nothing else in a Shadowdark world runs the core dying rule (p.89): the
 * system only marks a PC prone and unconscious when damage takes it to 0 HP,
 * and Crawl Helper, which used to run death timers, is what this module
 * replaces. The rules are in dying-core.mjs; this file is the Foundry half.
 *
 * EVERY WRITE IS THE ACTIVE GM'S, in one queue per actor (`serial`), so a heal
 * landing while a roll is out waits for it and then clears it, and a second GM
 * cannot write stale state over the first. A GM who is not the active one has
 * its buttons and crawl ticks relayed (`gmDo`).
 *
 * - 0 HP, by any path (damage or a sheet edit): the `updateActor` hook. The PC
 *   gets the Dying status and unconscious, and its death timer is rolled on the
 *   spot: the owning player's client rolls the die (a user query, so the dice
 *   are theirs) and the GM adds the modifiers; with the hidden timer on, the
 *   GM's client rolls blind. Fatality skips all of it: 0 HP is death.
 * - Turn start: `Combat#_onStartTurn`, wrapped. Foundry calls it on the active
 *   GM only, once per turn passed, including turns skipped by "Skip Defeated"
 *   (the system marks a 0 HP PC defeated), which `combatTurnChange` would miss.
 *   The owner rolls a d20; a natural 20 (or a rise-range modifier) rises at
 *   1 HP, anything else takes a round off; at 0 the PC is dead.
 * - Out of combat: the crawl round (`shadowdark-enhancer.crawlRound`, fired by
 *   CrawlState.nextCrawlTurn on the GM that advanced it), for crawl members.
 * - A round counts once per scope and only moving forward (`shouldTick`), so a
 *   rewind and the replay forward never cost a round twice.
 * - Stabilize: the helper's own INT check, marked in its roll config. The
 *   active GM reads every marked card as it lands, a Luck reroll's included,
 *   and decides on the dice against a DC it works out itself.
 * - HP above 0 clears it all.
 *
 * The state is ONE actor flag, `dying`: `{ timer, stable, conscious, tick }`,
 * written through replaceModuleFlag. Dead is core's `dead` status plus
 * `combatant.defeated`; a dead actor is never dying, whatever its flag says.
 *
 * With Shadowdark Crawl Helper active all of this stays off (it runs its own
 * timers); the module's existing Crawl Helper warning says so.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { esc } from "../shared/esc.mjs";
import { isActiveGM, refuseQuery, queryActiveGM } from "../shared/gm-relay.mjs";
import {
  DYING_STATUS, DEAD_STATUS, DYING_KEYS, NEAR_FEET, modifier, timerRoll, deathTimer, stabilizeDC,
  riseMin, turnOutcome, hpAction, shouldTick, cardStabilizes, badge, checkedNatural,
} from "./dying-core.mjs";

export { DYING_STATUS, DYING_KEYS };

/** GM → owner rolls, player → GM stabilize DCs, GM → active GM buttons. All authenticated. */
export const DYING_QUERY = `${MODULE_ID}.dying`;

const FLAG = "dying";
const CRAWL_HELPER = "shadowdark-crawl-helper";
/** A roll is automatic on the owner's client; this only covers a lost tab. */
const ROLL_TIMEOUT_MS = 10000;

let _enabled = false;

const fmt = (key, data = {}) => game.i18n.format(key, data);
const on = (key) => game.settings.get(MODULE_ID, key) === true;
const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const isDead = (actor) => !!actor?.statuses?.has(DEAD_STATUS);
const flagOf = (actor) => actor?.flags?.[MODULE_ID]?.[FLAG] ?? null;

/** The dying flag, `{ timer, stable, conscious, tick }`, or null. Null for the dead. */
export const dyingState = (actor) => (isDead(actor) ? null : flagOf(actor));
/** Dying and not stabilized. */
export const isDying = (actor) => { const s = dyingState(actor); return !!s && !s.stable; };
/** Rounds left, or null (not dying, or not rolled yet). Players can read it; the hidden timer only hides the UI. */
export const timer = (actor) => (isDying(actor) ? dyingState(actor).timer ?? null : null);

const _chains = new Map();

/** Run `fn` after every earlier dying step for this actor: one writer, in order. */
function serial(actor, fn) {
  const run = (_chains.get(actor.uuid) ?? Promise.resolve())
    .then(() => fn())
    .catch((err) => console.error(`${MODULE_ID} | dying: ${actor.name}`, err));
  _chains.set(actor.uuid, run);
  return run;
}

// ── Rolls ───────────────────────────────────────────────────────────────────

/** The player who rolls for a PC: its assigned player if online, else any online owner. */
function rollerFor(actor) {
  const players = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return players.find((u) => u.character?.id === actor.id) ?? players[0] ?? null;
}

/** Roll here and post it. `secret`: GMs only. Returns the natural die. */
async function rollHere(actor, formula, flavor, { secret = false } = {}) {
  const roll = await new Roll(formula).evaluate();
  const mode = !secret ? {} : game.release?.generation >= 14 ? { messageMode: "gm" } : { rollMode: "gmroll" };
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor }, mode);
  return roll.dice[0]?.total;
}

/** The natural die, rolled on the owning player's client; on the GM's when none answers usably. */
async function ownerRoll(actor, formula, flavor, faces) {
  const user = rollerFor(actor);
  if (user) {
    try {
      const reply = await user.query(DYING_QUERY, { action: "roll", uuid: actor.uuid, formula, flavor }, { timeout: ROLL_TIMEOUT_MS });
      const natural = checkedNatural(reply, faces);
      if (natural !== null) return natural;
    } catch (err) {
      console.warn(`${MODULE_ID} | ${user.name} could not roll for ${actor.name}; the GM rolls instead`, err);
    }
  }
  return rollHere(actor, formula, flavor);
}

// ── Chat ────────────────────────────────────────────────────────────────────

function say(actor, key, { gm = false, ...data } = {}) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p class="sde-dying-line">${esc(fmt(key, { name: actor.name, ...data }))}</p>`,
    whisper: gm ? gmIds() : [],
  });
}

/** Rounds left: to the GMs alone while the hidden timer is on. */
const sayRounds = (actor, rounds) => say(actor, "SDE.dying.rounds", { rounds, gm: on("dyingHiddenTimer") });

// ── Steps (active GM, inside serial) ───────────────────────────────────────

/** Every combatant, in every combat, that is this actor. */
async function setDefeated(actor, defeated) {
  for (const combat of game.combats ?? []) {
    for (const c of combat.combatants) {
      const match = actor.isToken ? c.tokenId === actor.token?.id : c.actorId === actor.id;
      if (match && c.defeated !== defeated) await c.update({ defeated });
    }
  }
}

/** Actors whose tokens are within near of this actor's token on the viewed scene. */
function nearby(actor, { allies = false } = {}) {
  const token = actor.getActiveTokens?.()[0];
  if (!token || !canvas?.ready) return [];
  // ponytail: the scene this client is viewing, the fight's in practice. The
  // active GM's view decides stabilize DCs and rise ranges.
  return canvas.tokens.placeables
    .filter((o) => o !== token && o.actor && (!allies || o.document.disposition === token.document.disposition))
    .filter((o) => canvas.grid.measurePath([token.center, o.center]).distance <= NEAR_FEET)
    .map((o) => o.actor);
}

/** The DC `by` needs to stabilize `actor`, as this client sees the scene. */
function localStabilizeDC(actor, by) {
  return stabilizeDC({
    ownDC: modifier(by, "stabilizeDC"),
    nearDCs: nearby(actor).map((a) => modifier(a, "stabilizeDCNear")),
    deadly: on("modeDeadlyStabilize"),
  });
}

/** The DC as the active GM works it out, which is the one that decides. */
export async function stabilizeDCFor(actor, by) {
  if (isActiveGM()) return localStabilizeDC(actor, by);
  const reply = await queryActiveGM(DYING_QUERY, { action: "dc", uuid: actor.uuid, byUuid: by.uuid },
    { label: fmt("SDE.dying.relayLabel") });
  return Number.isFinite(reply?.dc) ? reply.dc : localStabilizeDC(actor, by);
}

/** Where a PC stands when it drops: its own turn has started, or the crawl round is under way. */
function currentTick(actor) {
  const combat = game.combat;
  if (combat?.started && combat.combatant?.actor === actor) return { scope: combat.id, round: combat.round };
  // The world setting is the crawl's source of truth (crawl-state.mjs).
  const crawl = game.settings.get(MODULE_ID, "crawlState");
  if (crawl?.mode === "crawl") return { scope: "crawl", round: Number(crawl.crawlTurn) || 0 };
  return null;
}

async function startDying(actor) {
  const tick = currentTick(actor);
  await actor.toggleStatusEffect(DYING_STATUS, { active: true });
  await actor.toggleStatusEffect("unconscious", { active: true });
  const r = timerRoll({
    deadly: on("modeDeadlyTimer"),
    die: modifier(actor, "timerDie"),
    bonus: modifier(actor, "timerBonus"),
    con: actor.system?.abilities?.con?.mod ?? 0,
  });
  let rounds = 1; // Deadly: no roll, 1 whatever the die and bonuses
  if (r) {
    const flavor = fmt("SDE.dying.timerFlavor");
    const natural = on("dyingHiddenTimer")
      ? await rollHere(actor, r.formula, flavor, { secret: true })
      : await ownerRoll(actor, r.formula, flavor, r.faces);
    rounds = deathTimer(natural + r.mod);
  }
  await replaceModuleFlag(actor, FLAG, { timer: rounds, stable: false, conscious: false, tick });
  await say(actor, "SDE.dying.start");
  await sayRounds(actor, rounds);
}

async function tick(actor, scope, round) {
  const s = dyingState(actor);
  if (!s || s.stable || !Number.isInteger(s.timer) || !shouldTick(s.tick, scope, round)) return;
  // Checked at the moment of the roll: an ally's aura counts if it is near now.
  const min = riseMin({
    own: modifier(actor, "riseMin"),
    near: nearby(actor, { allies: true }).map((a) => modifier(a, "riseMinNear")),
  });
  const natural = await ownerRoll(actor, "1d20", fmt("SDE.dying.riseFlavor", { min }), 20);
  const out = turnOutcome({ natural, timer: s.timer, riseMin: min });
  if (out.result === "rise") return doRise(actor);
  if (out.result === "dead") return die(actor);
  await replaceModuleFlag(actor, FLAG, { ...s, timer: out.timer, tick: { scope, round } });
  await sayRounds(actor, out.timer);
}

/** A new crawl restarts the round count: forget the old crawl's last tick. */
async function forgetCrawl(actor) {
  const s = flagOf(actor);
  if (s?.tick?.scope === "crawl") await replaceModuleFlag(actor, FLAG, { ...s, tick: null });
}

async function clear(actor) {
  const tracked = !!flagOf(actor) || actor.statuses.has(DYING_STATUS);
  if (flagOf(actor)) await actor.unsetFlag(MODULE_ID, FLAG);
  await actor.toggleStatusEffect(DYING_STATUS, { active: false });
  if (tracked) await actor.toggleStatusEffect("unconscious", { active: false });
  await setDefeated(actor, false);
}

async function doRise(actor) {
  if ((actor.system?.attributes?.hp?.value ?? 0) < 1) await actor.update({ "system.attributes.hp.value": 1 });
  await clear(actor);
  await say(actor, "SDE.dying.rise");
}

async function die(actor) {
  if (flagOf(actor)) await actor.unsetFlag(MODULE_ID, FLAG);
  await actor.toggleStatusEffect(DYING_STATUS, { active: false });
  await actor.toggleStatusEffect(DEAD_STATUS, { active: true, overlay: true });
  // The dead status's createActiveEffect is what moves the turn pointer off a
  // PC who died at its own turn start (turn-skip.mjs): the system had already
  // marked it defeated, so the update below may change nothing.
  await setDefeated(actor, true);
  await say(actor, "SDE.dying.dead");
}

async function applyStable(actor) {
  const s = dyingState(actor);
  if (!s || s.stable) return;
  await replaceModuleFlag(actor, FLAG, { ...s, stable: true, timer: null, conscious: false });
  await actor.toggleStatusEffect(DYING_STATUS, { active: false });
  await actor.toggleStatusEffect("unconscious", { active: true });
  await say(actor, "SDE.dying.stabilized");
}

async function doAdjust(actor, delta) {
  const s = dyingState(actor);
  if (!s || s.stable || !Number.isInteger(s.timer)) return null;
  const next = Math.max(1, s.timer + Math.trunc(Number(delta) || 0));
  await replaceModuleFlag(actor, FLAG, { ...s, timer: next });
  await sayRounds(actor, next);
  return next;
}

async function doConscious(actor, conscious) {
  const s = dyingState(actor);
  if (!s || s.stable) return false;
  await replaceModuleFlag(actor, FLAG, { ...s, conscious: !!conscious });
  await actor.toggleStatusEffect("unconscious", { active: !conscious });
  // Acting while dying: core's Skip Defeated must not skip the turns it acts in.
  if (conscious) await setDefeated(actor, false);
  return true;
}

/** Re-read HP inside the queue, so a heal that lands mid-roll is not decided on stale state. */
async function onHp(actor) {
  const action = hpAction({
    hp: actor.system?.attributes?.hp?.value ?? 1,
    tracked: !!flagOf(actor),
    dead: isDead(actor),
    fatality: on("modeFatality"),
  });
  if (action === "dying") return startDying(actor);
  if (action === "die") return die(actor);
  if (action === "clear") return clear(actor);
}

/** A marked stabilize check card, first roll or Luck reroll, read on the active GM. */
async function stabilizeFromCard(actor, message, config) {
  if (!isDying(actor)) return;
  const by = fromUuidSync(config.actorUuid);
  const author = message.author;
  if (!by || !author) return;
  const main = message.rolls?.find((r) => r.options?.type === "main") ?? message.rolls?.[0];
  const ok = cardStabilizes({
    authorIsGM: !!author.isGM,
    authorOwnsHelper: by.testUserPermission(author, "OWNER"),
    helperIsTarget: by.uuid === actor.uuid,
    total: main?.total,
    dc: localStabilizeDC(actor, by),
  });
  if (ok) await applyStable(actor);
}

/** What a GM's click does, run on the active GM through the actor's queue. */
const GM_OPS = {
  tick: (actor, { scope, round }) => tick(actor, scope, round),
  forgetCrawl: (actor) => forgetCrawl(actor),
  stabilize: (actor) => applyStable(actor),
  adjust: (actor, { delta }) => doAdjust(actor, delta),
  conscious: (actor, { value }) => doConscious(actor, value),
  rise: (actor) => doRise(actor),
};

/** Run a GM op on the active GM: here if this is it, else relayed. */
async function gmDo(actor, op, args = {}) {
  if (isActiveGM()) return serial(actor, () => GM_OPS[op](actor, args));
  if (!game.user.isGM) return null;
  const reply = await queryActiveGM(DYING_QUERY, { action: "gm", op, uuid: actor.uuid, args },
    { label: fmt("SDE.dying.relayLabel") });
  if (!reply?.ok) {
    if (reply?.error) ui.notifications.warn(reply.error);
    return null;
  }
  return reply.value ?? null;
}

// ── Public (game.shadowdarkEnhancer.dying) ─────────────────────────────────

/**
 * Stabilize a dying PC. With `by`, that character makes the INT check (the
 * system's roll, on this client, so `by` must be yours) against the DC the
 * active GM works out; the active GM stabilizes when the card lands, and a
 * Luck reroll of the check counts too. Resolves to whether this roll
 * succeeded. Without `by` it is the GM's button: no roll.
 * @returns {Promise<boolean>}
 */
export async function stabilize(actor, { by = null } = {}) {
  if (!isDying(actor)) return false;
  if (!by) {
    if (!game.user.isGM) return false;
    await gmDo(actor, "stabilize");
    return true;
  }
  if (by.uuid === actor.uuid) return false;
  if (!by.system?.abilities?.int || typeof by.system.rollStatCheck !== "function") {
    ui.notifications.warn(fmt("SDE.dying.noInt", { name: by.name }));
    return false;
  }
  const roll = await by.system.rollStatCheck("int", {
    mainRoll: { dc: await stabilizeDCFor(actor, by) },
    title: fmt("SDE.dying.checkTitle", { name: actor.name }),
    // Rides the card's rollConfig, and so every reroll of it.
    [MODULE_ID]: { stabilizeTarget: actor.uuid },
  });
  return !!roll?.success;
}

/** GM: rise now, at 1 HP (Last Stand's automatic success, a miracle). */
export async function rise(actor) {
  if (!game.user.isGM || !dyingState(actor)) return false;
  await gmDo(actor, "rise");
  return true;
}

/** GM: add (or with a negative delta remove) rounds; never below 1. Returns the new count. */
export async function adjust(actor, delta) {
  if (!game.user.isGM || !isDying(actor)) return null;
  return gmDo(actor, "adjust", { delta: Math.trunc(Number(delta) || 0) });
}

/** GM: conscious while dying (acting on borrowed rounds), or unconscious again. The timer still runs. */
export async function setConscious(actor, conscious = true) {
  if (!game.user.isGM || !isDying(actor)) return false;
  return !!(await gmDo(actor, "conscious", { value: !!conscious }));
}

/**
 * CON has reached 0 (stat damage, #182): dead, unless the character carries
 * `noDeathAtZeroCon` (River of Death). Active GM only; resolves to whether it
 * died. Called by StatDamage, not public.
 */
export async function onConZero(actor) {
  if (!actor || !isActiveGM()) return false;
  return !!(await serial(actor, async () => {
    if (isDead(actor) || modifier(actor, "noDeathAtZeroCon")) return false;
    await die(actor);
    return true;
  }));
}

// ── Relay ───────────────────────────────────────────────────────────────────

async function handleQuery(data, user) {
  if (data?.action === "roll") {
    // GM → the owning player. The sender is stamped by the server.
    if (!user?.isGM) return { ok: false };
    const actor = fromUuidSync(data.uuid);
    if (!actor?.isOwner) return { ok: false };
    return { ok: true, natural: await rollHere(actor, String(data.formula), String(data.flavor ?? "")) };
  }
  const refused = refuseQuery(user, fmt("SDE.dying.relayLabel"));
  if (refused) return refused;
  const actor = fromUuidSync(data?.uuid);
  if (!actor) return { ok: false, error: fmt("SDE.dying.notDying", { name: "" }) };
  if (data.action === "dc") {
    const by = fromUuidSync(data.byUuid);
    return by ? { ok: true, dc: localStabilizeDC(actor, by) } : { ok: false };
  }
  if (data.action === "gm") {
    if (!user.isGM) return { ok: false, error: fmt("SDE.dying.gmOnly") };
    if (!Object.hasOwn(GM_OPS, data.op)) return { ok: false, error: fmt("SDE.dying.unknown") };
    const value = await serial(actor, () => GM_OPS[data.op](actor, data.args ?? {}));
    return { ok: true, value: value ?? null };
  }
  return { ok: false, error: fmt("SDE.dying.unknown") };
}

// ── Crawl strip ─────────────────────────────────────────────────────────────

/** The dying badge for a PC's strip card: a button for the GM, and for players while it is dying. */
export function badgeHTML(actor) {
  if (!_enabled) return "";
  const b = badge(dyingState(actor), { hidden: on("dyingHiddenTimer"), isGM: game.user.isGM });
  if (!b) return "";
  const label = b.kind === "stable" ? fmt("SDE.dying.stable")
    : b.rounds === null ? fmt("SDE.dying.status") : fmt("SDE.dying.badge", { rounds: b.rounds });
  const cls = `sde-strip-dying sde-strip-dying-${b.kind}`;
  if (!game.user.isGM && b.kind !== "dying") return `<div class="${cls}">${esc(label)}</div>`;
  return `<button type="button" class="${cls}" data-action="dying" data-actor-uuid="${esc(actor.uuid)}" title="${esc(fmt("SDE.dying.menuTitle", { name: actor.name }))}">${esc(label)}</button>`;
}

/** The dying card's actions: stabilize with your selected character, and the GM's buttons. */
export async function openMenu(actor) {
  const s = dyingState(actor);
  if (!s) return;
  const helper = canvas.tokens?.controlled?.map((tk) => tk.actor).find((a) => a && a.uuid !== actor.uuid)
    ?? (game.user.character && game.user.character.uuid !== actor.uuid ? game.user.character : null);
  const buttons = [];
  if (!s.stable && helper) {
    const dc = await stabilizeDCFor(actor, helper);
    buttons.push({ action: "check", label: fmt("SDE.dying.stabilizeWith", { name: helper.name, dc }) });
  }
  if (game.user.isGM) {
    if (!s.stable) {
      buttons.push(
        { action: "stabilize", label: fmt("SDE.dying.stabilizeNow") },
        { action: "add", label: fmt("SDE.dying.addRound") },
        { action: "remove", label: fmt("SDE.dying.removeRound") },
        { action: "conscious", label: s.conscious ? fmt("SDE.dying.unconsciousAgain") : fmt("SDE.dying.conscious") },
      );
    }
    buttons.push({ action: "rise", label: fmt("SDE.dying.riseNow") });
  }
  if (!buttons.length) {
    ui.notifications.info(fmt("SDE.dying.noHelper"));
    return;
  }
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: fmt("SDE.dying.menuTitle", { name: actor.name }) },
    classes: ["sde-dying-menu"],
    content: `<p>${esc(fmt("SDE.dying.menuHint"))}</p>`,
    buttons,
    rejectClose: false,
  });
  if (choice === "check") return stabilize(actor, { by: helper });
  if (choice === "stabilize") return stabilize(actor);
  if (choice === "add") return adjust(actor, 1);
  if (choice === "remove") return adjust(actor, -1);
  if (choice === "conscious") return setConscious(actor, !s.conscious);
  if (choice === "rise") return rise(actor);
}

// ── Wiring ──────────────────────────────────────────────────────────────────

export function init() {
  if (!CONFIG.statusEffects.some((e) => e.id === DYING_STATUS)) {
    CONFIG.statusEffects.push({ id: DYING_STATUS, name: "SDE.dying.status", img: "icons/svg/degen.svg" });
  }
  CONFIG.queries[DYING_QUERY] = (data, { user } = {}) => handleQuery(data, user);
  // Crawl Helper runs its own timers. The module's one Crawl Helper warning
  // (checkCoexistence, with its opt-out) says dying is off.
  if (game.modules.get(CRAWL_HELPER)?.active) return;
  _enabled = true;

  Hooks.on("updateActor", (actor, changes) => {
    if (changes?.system?.attributes?.hp?.value === undefined) return;
    if (actor.type !== "Player" || !isActiveGM()) return;
    void serial(actor, () => onHp(actor));
  });

  const proto = CONFIG.Combat.documentClass.prototype;
  const original = proto._onStartTurn;
  proto._onStartTurn = async function (combatant, context) {
    await original.call(this, combatant, context);
    const actor = combatant?.actor;
    // Queued for every PC, not only the dying: a drop still in flight is
    // written before this runs, and tick re-reads. Not awaited: the owner's
    // roll must not hold up Foundry's turn events.
    if (actor?.type === "Player") {
      void serial(actor, () => tick(actor, this.id, context?.round ?? this.round));
    }
  };

  // Crawl rounds and a crawl's end fire on the GM that clicked; gmDo takes
  // them to the active GM.
  const members = (state) => (state?.members ?? []).map((id) => game.actors.get(id)).filter((a) => a?.type === "Player");
  Hooks.on(`${MODULE_ID}.crawlRound`, (state) => {
    if (!game.user.isGM) return;
    for (const actor of members(state)) void gmDo(actor, "tick", { scope: "crawl", round: state.crawlTurn });
  });
  Hooks.on(`${MODULE_ID}.crawlEnd`, (state) => {
    if (!game.user.isGM) return;
    for (const actor of members(state)) if (flagOf(actor)) void gmDo(actor, "forgetCrawl");
  });

  // Stabilize checks, and Luck rerolls of them, as their cards land.
  Hooks.on("createChatMessage", (message) => {
    if (!isActiveGM()) return;
    const config = message.flags?.shadowdark?.rollConfig;
    const target = config?.[MODULE_ID]?.stabilizeTarget;
    const actor = target ? fromUuidSync(target) : null;
    if (actor) void serial(actor, () => stabilizeFromCard(actor, message, config));
  });
}
