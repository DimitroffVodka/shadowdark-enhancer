/**
 * Shadowdark Enhancer — dying, death timers and stabilizing (#181).
 *
 * Nothing else in a Shadowdark world runs the core dying rule (p.89): the
 * system only marks a PC prone and unconscious when damage takes it to 0 HP,
 * and Crawl Helper, which used to run death timers, is what this module
 * replaces. The rules are in dying-core.mjs; this file is the Foundry half.
 *
 * WHERE THINGS HAPPEN, all on the active GM's client:
 *
 * - 0 HP, by any path (damage or a sheet edit): the `updateActor` hook. The PC
 *   gets the Dying status and unconscious, and its death timer is rolled on the
 *   spot, by the owning player (a user query to their client, so the dice are
 *   theirs) or, with the hidden timer on, blind on the GM's client. Fatality
 *   skips all of it: 0 HP is death.
 * - Turn start: `Combat#_onStartTurn`, wrapped. Foundry calls it on the active
 *   GM only, once per turn passed, including turns skipped by "Skip Defeated"
 *   (the system marks a 0 HP PC defeated), which `combatTurnChange` would miss.
 *   The owner rolls a d20; a natural 20 (or a rise-range modifier) rises at
 *   1 HP, anything else takes a round off; at 0 the PC is dead.
 * - Out of combat: the crawl round (`shadowdark-enhancer.crawlRound`, fired by
 *   CrawlState.nextCrawlTurn on the GM that advanced it), for crawl members.
 * - HP above 0 clears it all.
 *
 * A tick is recorded under its combat round (or crawl round), so a rewound or
 * re-started turn, or Chaos Mode moving the turn, never ticks twice in a round.
 * Every step for one actor runs in order through `serial`, so a heal landing
 * while the timer roll is out waits for it and then clears it.
 *
 * The state is ONE actor flag, `dying`: `{ timer, stable, conscious, tick }`,
 * written through replaceModuleFlag. Dead is core's `dead` status plus
 * `combatant.defeated`, and the flag is gone.
 *
 * With Shadowdark Crawl Helper active all of this stays off (it runs its own
 * timers) and the GM is told once.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { esc } from "../shared/esc.mjs";
import { isActiveGM, refuseQuery, authorizeActorRequest, relayToGM } from "../shared/gm-relay.mjs";
import {
  DYING_STATUS, DEAD_STATUS, DYING_KEYS, NEAR_FEET, modifier, timerRoll, deathTimer, stabilizeDC,
  riseMin, turnOutcome, hpAction, tickKey, badge, checkedRoll,
} from "./dying-core.mjs";

export { DYING_STATUS, DYING_KEYS };

/** GM → owner roll requests and player → GM stabilizes, both ways authenticated. */
export const DYING_QUERY = `${MODULE_ID}.dying`;

const FLAG = "dying";
const CRAWL_HELPER = "shadowdark-crawl-helper";
/** A roll is automatic on the owner's client; this only covers a lost tab. */
const ROLL_TIMEOUT_MS = 10000;

let _enabled = false;

const fmt = (key, data = {}) => game.i18n.format(key, data);
const on = (key) => game.settings.get(MODULE_ID, key) === true;
const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

/** The dying flag, `{ timer, stable, conscious, tick }`, or null. */
export const dyingState = (actor) => actor?.flags?.[MODULE_ID]?.[FLAG] ?? null;
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

/** Roll here and post it. `secret`: GMs only. */
async function rollHere(actor, formula, flavor, { secret = false } = {}) {
  const roll = await new Roll(formula).evaluate();
  const mode = !secret ? {} : game.release?.generation >= 14 ? { messageMode: "gm" } : { rollMode: "gmroll" };
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor }, mode);
  return { total: roll.total, natural: roll.dice[0]?.total };
}

/** Roll on the owning player's client; on the GM's when none is online or the reply is unusable. */
async function ownerRoll(actor, formula, flavor, faces) {
  const user = rollerFor(actor);
  if (user) {
    try {
      const reply = await user.query(DYING_QUERY, { action: "roll", uuid: actor.uuid, formula, flavor }, { timeout: ROLL_TIMEOUT_MS });
      const checked = checkedRoll(reply, faces);
      if (checked) return checked;
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

// ── Steps (GM side, inside serial) ─────────────────────────────────────────

/** Every combatant, in every combat, that is this actor. */
async function setDefeated(actor, defeated) {
  for (const combat of game.combats) {
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
  // ponytail: the viewed scene only, which is the scene of the fight in practice.
  return canvas.tokens.placeables
    .filter((o) => o !== token && o.actor && (!allies || o.document.disposition === token.document.disposition))
    .filter((o) => canvas.grid.measurePath([token.center, o.center]).distance <= NEAR_FEET)
    .map((o) => o.actor);
}

/** The DC `by` needs to stabilize `actor`. */
export function stabilizeDCFor(actor, by) {
  return stabilizeDC({
    ownDC: modifier(by, "stabilizeDC"),
    nearDCs: nearby(actor).map((a) => modifier(a, "stabilizeDCNear")),
    deadly: on("modeDeadlyStabilize"),
  });
}

async function startDying(actor) {
  const combat = game.combat;
  // Dropping during its own turn: that turn has already started, so the first
  // roll is next round's.
  const own = combat?.started && combat.combatant?.actor === actor;
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
    const rolled = on("dyingHiddenTimer")
      ? await rollHere(actor, r.formula, flavor, { secret: true })
      : await ownerRoll(actor, r.formula, flavor, r.faces);
    rounds = deathTimer(rolled.total);
  }
  await replaceModuleFlag(actor, FLAG, {
    timer: rounds, stable: false, conscious: false, tick: own ? tickKey(combat.id, combat.round) : null,
  });
  await say(actor, "SDE.dying.start");
  await sayRounds(actor, rounds);
}

async function tick(actor, key) {
  const s = dyingState(actor);
  if (!s || s.stable || !Number.isInteger(s.timer) || s.tick === key) return;
  // Checked at the moment of the roll: an ally's aura counts if it is near now.
  const min = riseMin({
    own: modifier(actor, "riseMin"),
    near: nearby(actor, { allies: true }).map((a) => modifier(a, "riseMinNear")),
  });
  const r = await ownerRoll(actor, "1d20", fmt("SDE.dying.riseFlavor", { min }), 20);
  const out = turnOutcome({ natural: r.natural, timer: s.timer, riseMin: min });
  if (out.result === "rise") return doRise(actor);
  if (out.result === "dead") return die(actor);
  await replaceModuleFlag(actor, FLAG, { ...s, timer: out.timer, tick: key });
  await sayRounds(actor, out.timer);
}

async function clear(actor) {
  const tracked = !!dyingState(actor) || actor.statuses.has(DYING_STATUS);
  if (dyingState(actor)) await actor.unsetFlag(MODULE_ID, FLAG);
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
  if (dyingState(actor)) await actor.unsetFlag(MODULE_ID, FLAG);
  await actor.toggleStatusEffect(DYING_STATUS, { active: false });
  await actor.toggleStatusEffect(DEAD_STATUS, { active: true, overlay: true });
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

/** Re-read HP inside the queue, so a heal that lands mid-roll is not decided on stale state. */
async function onHp(actor) {
  const action = hpAction({
    hp: actor.system?.attributes?.hp?.value ?? 1,
    tracked: !!dyingState(actor),
    dead: actor.statuses.has(DEAD_STATUS),
    fatality: on("modeFatality"),
  });
  if (action === "dying") return startDying(actor);
  if (action === "die") return die(actor);
  if (action === "clear") return clear(actor);
}

// ── Public (game.shadowdarkEnhancer.dying) ─────────────────────────────────

/**
 * Stabilize a dying PC. With `by`, that character makes the INT check (the
 * system's roll, on this client, so `by` must be yours) and a success
 * stabilizes; a player's success is relayed to the GM. Without `by` it is the
 * GM's button: no roll (a potion, an automatic success).
 * @returns {Promise<boolean>}
 */
export async function stabilize(actor, { by = null } = {}) {
  if (!isDying(actor)) return false;
  if (by) {
    if (by.uuid === actor.uuid) return false;
    if (!by.system?.abilities?.int || typeof by.system.rollStatCheck !== "function") {
      ui.notifications.warn(fmt("SDE.dying.noInt", { name: by.name }));
      return false;
    }
    const roll = await by.system.rollStatCheck("int", {
      mainRoll: { dc: stabilizeDCFor(actor, by) },
      title: fmt("SDE.dying.checkTitle", { name: actor.name }),
    });
    if (!roll?.success) return false;
  } else if (!game.user.isGM) return false;
  if (!game.user.isGM) {
    return relayToGM(DYING_QUERY, { action: "stabilize", uuid: actor.uuid, byUuid: by.uuid },
      { label: fmt("SDE.dying.relayLabel") });
  }
  await serial(actor, () => applyStable(actor));
  return true;
}

/** GM: rise now, at 1 HP (Last Stand's automatic success, a miracle). */
export async function rise(actor) {
  if (!game.user.isGM || !dyingState(actor)) return false;
  await serial(actor, () => doRise(actor));
  return true;
}

/** GM: add (or with a negative delta remove) rounds; never below 1. Returns the new count. */
export async function adjust(actor, delta) {
  if (!game.user.isGM || !isDying(actor)) return null;
  return serial(actor, async () => {
    const s = dyingState(actor);
    if (!s || s.stable || !Number.isInteger(s.timer)) return null;
    const next = Math.max(1, s.timer + Math.trunc(Number(delta) || 0));
    await replaceModuleFlag(actor, FLAG, { ...s, timer: next });
    await sayRounds(actor, next);
    return next;
  });
}

/** GM: conscious while dying (acting on borrowed rounds), or unconscious again. The timer still runs. */
export async function setConscious(actor, conscious = true) {
  if (!game.user.isGM || !isDying(actor)) return false;
  await serial(actor, async () => {
    const s = dyingState(actor);
    if (!s || s.stable) return;
    await replaceModuleFlag(actor, FLAG, { ...s, conscious: !!conscious });
    await actor.toggleStatusEffect("unconscious", { active: !conscious });
  });
  return true;
}

/**
 * GM: a character's CON has reached 0 (stat damage, #182). Dead, unless it
 * carries `noDeathAtZeroCon` (River of Death). Returns whether it died.
 */
export async function onConZero(actor) {
  if (!game.user.isGM || !actor || modifier(actor, "noDeathAtZeroCon")) return false;
  await serial(actor, () => die(actor));
  return true;
}

// ── Relay ───────────────────────────────────────────────────────────────────

async function handleQuery(data, user) {
  if (data?.action === "roll") {
    // GM → the owning player. The sender is stamped by the server.
    if (!user?.isGM) return { ok: false };
    const actor = fromUuidSync(data.uuid);
    if (!actor?.isOwner) return { ok: false };
    return { ok: true, ...(await rollHere(actor, String(data.formula), String(data.flavor ?? ""))) };
  }
  if (data?.action !== "stabilize") return { ok: false };
  const refused = refuseQuery(user, fmt("SDE.dying.relayLabel"));
  if (refused) return refused;
  const actor = fromUuidSync(data.uuid);
  const by = fromUuidSync(data.byUuid);
  const verdict = authorizeActorRequest({
    actorExists: !!by, requesterIsGM: !!user.isGM, requesterOwnsActor: !!by?.testUserPermission(user, "OWNER"),
  });
  if (!verdict.ok) return verdict;
  if (!isDying(actor) || by.uuid === actor.uuid) return { ok: false, error: fmt("SDE.dying.notDying", { name: actor?.name ?? "" }) };
  await serial(actor, () => applyStable(actor));
  return { ok: true };
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
    buttons.push({ action: "check", label: fmt("SDE.dying.stabilizeWith", { name: helper.name, dc: stabilizeDCFor(actor, helper) }) });
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

  if (game.modules.get(CRAWL_HELPER)?.active) {
    if (isActiveGM()) ui.notifications.warn(fmt("SDE.dying.crawlHelper"));
    return;
  }
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
    // Not awaited: the owner's roll must not hold up Foundry's turn events.
    if (actor?.type === "Player" && isDying(actor)) {
      void serial(actor, () => tick(actor, tickKey(this.id, context?.round ?? this.round)));
    }
  };

  Hooks.on(`${MODULE_ID}.crawlRound`, (state) => {
    if (!game.user.isGM) return;
    for (const id of state?.members ?? []) {
      const actor = game.actors.get(id);
      if (actor?.type === "Player" && isDying(actor)) {
        void serial(actor, () => tick(actor, tickKey("crawl", state.crawlTurn)));
      }
    }
  });
}
