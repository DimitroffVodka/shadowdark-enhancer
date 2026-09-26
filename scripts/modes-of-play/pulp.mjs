/**
 * Shadowdark Enhancer — Pulp Mode (core rulebook p.111), the three rules this
 * module builds; the system owns "no maximum on luck" (shadowdark.usePulpMode)
 * and the crawl strip's luck pill covers "luck for an extra action".
 *
 * 1. `modePulpSessionLuck`: choosing Start New Session in Session Recap's
 *    prompt when a crawl starts fires `shadowdark-enhancer.sessionStart`
 *    (Continue Session does not); each player's assigned character has
 *    its luck SET to 1d4, as the system's own initializeLuck macro does, and
 *    one card lists the rolls.
 * 2. `modePulpLuckCrit`: a "Luck: critical hit" button on the owner's attack
 *    card once it shows a hit. Damage already on the card keeps its dice and
 *    gains only what a crit adds (critExtraFormula); damage not rolled yet is
 *    rolled once, as a crit, through the system's rollDamage.
 * 3. `modePulpForceReroll`: a "Luck: force a reroll" button on a GM's roll the
 *    player can see, when a reroll can change it (forceShape); the GM's roll
 *    is rerolled on the card, and the card says who forced it. An attack's
 *    damage follows the new roll (forcedDamage).
 *
 * Both buttons relay to the active GM (gm-relay.mjs's authenticated query):
 * the GM's client checks the requester, builds the changed card, then spends
 * the token and writes the card, so a player can neither spend without the
 * effect nor get the effect without spending. One request per card at a time,
 * so two players can't both spend on the same card. Each spend is logged in
 * Session Recap like any luck reroll. Pure decisions live in pulp-core.mjs.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { relayToGM, refuseQuery } from "../shared/gm-relay.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import {
  critExtraFormula, showLuckCrit, showForceReroll, forceShape, uncritFormula, forcedDamage,
} from "./pulp-core.mjs";

export const PULP_QUERY = `${MODULE_ID}.pulp`;
const FLAG_CRIT = "pulpLuckCrit";
const FLAG_FORCED = "pulpForcedBy";

const on = (key) => game.settings.get(MODULE_ID, key) === true;
const mainOf = (msg) => msg.getRoll?.("main") ?? msg.rolls?.find((r) => r.options?.type === "main") ?? null;
const damageOf = (msg) => msg.getRoll?.("damage") ?? msg.rolls?.find((r) => r.options?.type === "damage") ?? null;
const shapeOf = (msg) => forceShape({
  systemCard: !!msg.getFlag("shadowdark", "rollConfig") && !!mainOf(msg),
  initiative: !!msg.getFlag("core", "initiativeRoll"),
  rollCount: msg.rolls?.length ?? 0,
  content: msg.content,
  total: msg.rolls?.[0]?.total,
});

// ── 1. Session luck ──────────────────────────────────────────────────────────

/**
 * GM side: set each player's character to 1d4 luck and post one card.
 * @param {User[]} [users]  who to roll for; every player by default
 */
export async function rollSessionLuck(users = game.users.players ?? game.users.filter((u) => !u.isGM)) {
  const rows = [];
  for (const user of users) {
    const actor = user.character;
    if (!actor) continue;
    const roll = await new Roll("1d4").evaluate();
    await actor.update({ "system.luck.available": true, "system.luck.remaining": roll.total });
    rows.push({ name: actor.name, total: roll.total, roll });
  }
  if (!rows.length) return rows;
  const list = rows.map((r) => `<li><strong>${esc(r.name)}</strong> ${esc(r.total)}</li>`).join("");
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("SDE.pulp.speaker") },
    content: `<div class="sde-pulp-card"><header>${esc(game.i18n.localize("SDE.pulp.sessionLuck"))}</header><ul>${list}</ul></div>`,
    rolls: rows.map((r) => r.roll),
  });
  return rows;
}

// ── 2. Luck crit and 3. forced reroll: the GM side ───────────────────────────

/**
 * The card update that turns a hit into a crit. Everything that can fail
 * happens here, before any luck is spent. Assumes the requester was checked.
 */
async function luckCritUpdate(msg, actor) {
  const config = foundry.utils.deepClone(msg.getFlag("shadowdark", "rollConfig"));
  const main = mainOf(msg);
  const damage = damageOf(msg);
  let newDamage;
  if (damage) {
    const extraFormula = critExtraFormula(damage.formula, config.damageRoll?.criticalMultiplier ?? 2,
      game.settings.get("shadowdark", "useMomentumMode") === true);
    if (extraFormula) {
      const extra = await new Roll(extraFormula, actor.getRollData()).evaluate();
      // An OperatorTerm is born evaluated; evaluating it again throws.
      const plus = new foundry.dice.terms.OperatorTerm({ operator: "+" });
      newDamage = damage.constructor.fromTerms([...damage.terms, plus, ...extra.terms], damage.options);
      // The system keeps a crit's formula in the config (roll() rewrites it),
      // so a later damage reroll, which skips applyCriticalHit, stays a crit.
      config.damageRoll.formula = newDamage.formula;
    } else newDamage = damage;
  } else {
    newDamage = await shadowdark.dice.rollDamage(config, true);
    if (!newDamage) return null;
  }
  config.damageRoll.criticalHit = true;
  return {
    update: {
      rolls: [main, newDamage, ...msg.rolls.filter((r) => r !== main && r !== damage)],
      content: await shadowdark.chat.renderRollHTML(config, [main, newDamage]),
      "flags.shadowdark.rollConfig": config,
      [`flags.${MODULE_ID}.${FLAG_CRIT}`]: true,
    },
    log: { formula: newDamage.formula, oldTotal: damage?.total ?? 0, newTotal: newDamage.total },
  };
}

/**
 * An attack's damage after its roll was forced: kept, rolled again from the
 * base formula (a crit doubles it once, Momentum explodes it once), or gone.
 */
async function forcedDamageRolls(config, damage, fresh) {
  if (!config.damageRoll?.formula) return [];
  const dr = config.damageRoll;
  const needed = !!fresh.success || (!!config.attack && !config.targetUuid);
  const oldCrit = dr.criticalHit === true;
  const newCrit = !!fresh.criticalSuccess;
  const plan = forcedDamage({ hadDamage: !!damage, needed, oldCrit, newCrit });
  dr.needed = needed;
  if (plan === "keep") return [damage];
  dr.criticalHit = plan === "reroll" && newCrit;
  if (plan === "drop") return [];
  const mult = dr.criticalMultiplier ?? 2;
  let formula = oldCrit ? uncritFormula(dr.formula, mult) : dr.formula;
  if (newCrit) formula = shadowdark.dice.applyCriticalHit(formula, mult);
  if (game.settings.get("shadowdark", "useMomentumMode") && !/d\d+x/i.test(formula)) {
    formula = shadowdark.dice.applyExploding(formula);
  }
  dr.formula = formula;
  // Not rolled until asked for, as the system does with its Roll Damage setting off.
  if (!game.settings.get("shadowdark", "rollDamage")) return [];
  // The formula is final: stop roll() doubling or exploding it a second time.
  const wasReroll = dr.reroll;
  dr.reroll = true;
  const rolled = await shadowdark.dice.rollDamage(config, newCrit);
  if (wasReroll === undefined) delete dr.reroll; else dr.reroll = wasReroll;
  return rolled ? [rolled] : [];
}

/** The card update that rerolls the GM's roll in place. Assumes the requester was checked. */
async function forcedRerollUpdate(msg, user) {
  const main = mainOf(msg) ?? msg.rolls[0];
  const fresh = await main.reroll();
  const update = { [`flags.${MODULE_ID}.${FLAG_FORCED}`]: user.name };
  if (shapeOf(msg) === "system") {
    const config = foundry.utils.deepClone(msg.getFlag("shadowdark", "rollConfig"));
    const rolls = [fresh, ...await forcedDamageRolls(config, damageOf(msg), fresh)];
    Object.assign(update, {
      rolls,
      content: await shadowdark.chat.renderRollHTML(config, rolls),
      "flags.shadowdark.rollConfig": config,
    });
  } else {
    update.rolls = msg.rolls.map((r) => (r === main ? fresh : r));
    update.content = String(fresh.total);
  }
  return { update, log: { formula: main.formula, oldTotal: main.total, newTotal: fresh.total } };
}

/** Spend one token, then change the card: a token is never spent on a card that could not be built. */
async function spendThenUpdate(actor, msg, { update, log }) {
  if (!(await actor.system.useLuckToken(true))) return { ok: false, error: game.i18n.localize("SDE.pulp.noLuck") };
  await msg.update(update);
  await SessionRecap.logLuckSpent({ player: actor.name, actorId: actor.id, ...log })
    .catch((err) => console.warn(`${MODULE_ID} | Pulp: could not log the luck spend`, err));
  return { ok: true };
}

/** Cards with a spend in progress on this GM: a second request waits its turn by being refused. */
const _busy = new Set();

/**
 * The GM's answer to a Pulp query. Identity comes from core's query context,
 * never the payload (gm-relay.mjs).
 * @param {{action:string, messageId:string}} data
 * @param {User} user
 */
export async function handlePulpQuery(data, user) {
  const refused = refuseQuery(user, game.i18n.localize("SDE.pulp.relayLabel"));
  if (refused) return refused;
  const msg = game.messages.get(data?.messageId);
  if (!msg) return { ok: false, error: game.i18n.localize("SDE.pulp.noCard") };
  if (_busy.has(msg.id)) return { ok: false, error: game.i18n.localize("SDE.pulp.busy") };
  _busy.add(msg.id);
  try {
    return await pulpAction(data, user, msg);
  } finally {
    _busy.delete(msg.id);
  }
}

async function pulpAction(data, user, msg) {

  if (data.action === "luckCrit") {
    if (!on("modePulpLuckCrit")) return { ok: false, error: game.i18n.localize("SDE.pulp.off") };
    const config = msg.getFlag("shadowdark", "rollConfig");
    const actor = config?.actorUuid ? await fromUuid(config.actorUuid) : null;
    const main = mainOf(msg);
    const allowed = actor && showLuckCrit({
      enabled: true, type: config?.type, success: main?.success ?? null, naturalCrit: main?.criticalSuccess === true,
      done: !!msg.getFlag(MODULE_ID, FLAG_CRIT), owner: actor.testUserPermission(user, "OWNER"), hasLuck: actor.system?.hasLuckToken,
    });
    if (!allowed) return { ok: false, error: game.i18n.localize("SDE.pulp.cantCrit") };
    const built = await luckCritUpdate(msg, actor);
    if (!built) return { ok: false, error: game.i18n.localize("SDE.pulp.noDamage") };
    return spendThenUpdate(actor, msg, built);
  }

  if (data.action === "forceReroll") {
    if (!on("modePulpForceReroll")) return { ok: false, error: game.i18n.localize("SDE.pulp.off") };
    const actor = user.character;
    const allowed = actor && showForceReroll({
      enabled: true, isGM: user.isGM, gmAuthored: !!msg.author?.isGM, shape: shapeOf(msg),
      blind: !!msg.blind, whisper: msg.whisper ?? [], userId: user.id,
      done: !!msg.getFlag(MODULE_ID, FLAG_FORCED), hasLuck: actor.system?.hasLuckToken,
    }) && actor.testUserPermission(user, "OWNER");
    if (!allowed) return { ok: false, error: game.i18n.localize("SDE.pulp.cantForce") };
    return spendThenUpdate(actor, msg, await forcedRerollUpdate(msg, user));
  }
  return { ok: false, error: game.i18n.localize("SDE.pulp.unknown") };
}

// ── The buttons ──────────────────────────────────────────────────────────────

function button(label, action, messageId) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sde-pulp-button";
  b.textContent = label;
  b.addEventListener("click", async (event) => {
    event.preventDefault();
    b.disabled = true;
    const ok = await relayToGM(PULP_QUERY, { action, messageId }, { label: game.i18n.localize("SDE.pulp.relayLabel") });
    if (!ok) b.disabled = false;
  });
  return b;
}

async function decorate(msg, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const forcedBy = msg.getFlag(MODULE_ID, FLAG_FORCED);
  if (forcedBy) {
    const note = document.createElement("p");
    note.className = "sde-pulp-note";
    note.textContent = game.i18n.format("SDE.pulp.forcedBy", { name: forcedBy });
    root.querySelector(".message-content")?.append(note);
  }
  if (msg.getFlag(MODULE_ID, FLAG_CRIT)) {
    const note = document.createElement("p");
    note.className = "sde-pulp-note";
    note.textContent = game.i18n.localize("SDE.pulp.critNote");
    root.querySelector(".message-content")?.append(note);
  }
  const holder = root.querySelector(".message-content");
  if (!holder) return;

  const config = msg.getFlag("shadowdark", "rollConfig");
  if (config?.actorUuid && on("modePulpLuckCrit")) {
    const actor = fromUuidSync(config.actorUuid, { strict: false });
    const main = mainOf(msg);
    const owner = !!actor?.isOwner && (!game.user.isGM || !actor.hasPlayerOwner);
    if (showLuckCrit({ enabled: true, type: config.type, success: main?.success ?? null,
      naturalCrit: main?.criticalSuccess === true, done: !!msg.getFlag(MODULE_ID, FLAG_CRIT),
      owner, hasLuck: actor?.system?.hasLuckToken })) {
      holder.append(button(game.i18n.localize("SDE.pulp.critButton"), "luckCrit", msg.id));
    }
  }
  if (on("modePulpForceReroll")) {
    const actor = game.user.character;
    if (showForceReroll({ enabled: true, isGM: game.user.isGM, gmAuthored: !!msg.author?.isGM,
      shape: shapeOf(msg), blind: !!msg.blind, whisper: msg.whisper ?? [], userId: game.user.id,
      done: !!forcedBy, hasLuck: actor?.system?.hasLuckToken })) {
      holder.append(button(game.i18n.localize("SDE.pulp.forceButton"), "forceReroll", msg.id));
    }
  }
}

export function init() {
  CONFIG.queries[PULP_QUERY] = (data, { user } = {}) => handlePulpQuery(data, user);
  Hooks.on("renderChatMessageHTML", (msg, html) => { void decorate(msg, html); });
  // Fired on the client of the GM who pressed Start session, and only there.
  Hooks.on(`${MODULE_ID}.sessionStart`, () => {
    if (!game.user?.isGM || !on("modePulpSessionLuck")) return;
    rollSessionLuck().catch((err) => console.error(`${MODULE_ID} | Pulp session luck`, err));
  });
}
