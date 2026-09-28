/**
 * Shadowdark Enhancer — warbands in mass combat (#203, PGWR p.249).
 *
 * A warband acts on its commander's turn: its combatant takes the
 * commander's initiative (so nothing rolls for it, Chaos Mode included) and
 * has no turn of its own (turn-skip-core's `follows`). With the commander
 * dead, or skipped as defeated, it rolls and takes its own. Morale is automatic:
 * when damage takes it to half HP, and each time it's hit while below half,
 * it checks d20 plus its commander's CHA against 15 (Loyal 9), with advantage
 * while the commander leads it; a failure rolls a rout, 3-in-6 (Withdraw
 * 1-in-6), and a routed warband is destroyed: defeated, with a chat card.
 * Its attack cards note the area it fills. Runs on the active GM.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { isAttackCard, actorFromUuidSync } from "../shared/attack-card.mjs";
import { leaderCombatant } from "../crawl-strip/turn-skip-core.mjs";
import * as core from "./warband-core.mjs";
import { WARBAND_FLAG, warbandState, warbandWrites } from "./warband-npc-sheet.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** The combat's own writes (initiative), one at a time; a warband's flag goes on warbandWrites. */
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch((err) => console.error(`${MODULE_ID} | warband combat`, err));
  return run;
};

const hpOf = (actor) => Number(actor?.system?.attributes?.hp?.value ?? 0);

/** Give a warband's combatant its commander's initiative, when it follows them and they differ. */
async function followInitiative(combatant) {
  const commander = leaderCombatant(combatant);
  const init = commander?.initiative;
  if (init === null || init === undefined || combatant.initiative === init) return;
  await combatant.update({ initiative: init });
}

/** After a combatant's initiative is set: a warband follows its commander, and a commander's warbands follow them. */
async function syncInitiative(combatant) {
  await followInitiative(combatant);
  for (const other of combatant.parent?.combatants ?? []) {
    if (other !== combatant && leaderCombatant(other) === combatant) await followInitiative(other);
  }
}

/** Morale, then perhaps a rout: the whole check, from the warband's state as it stands now. */
async function moraleCheck(actor) {
  const st = warbandState(actor);
  // A warband in no one's service (just made or imported, a copy, its Commander box emptied) has no
  // commander's CHA and no morale to break, as the arrears skip it too (Patrick, 2026-09-28). A dead
  // commander is still its commander.
  if (st.routed || st.deserted || !st.commander) return;
  const pc = await fromUuid(st.commander).catch(() => null);
  // A commander since deleted serves no one either, as the arrears check skips it too (#285 review).
  if (!pc) return;
  const cha = Number(pc?.system?.abilities?.cha?.mod) || 0;
  const leading = st.leading && !!pc;
  const dc = core.moraleDC(st.upgrades);
  const roll = await new Roll(core.moraleFormula(cha, leading)).evaluate();
  const held = roll.total >= dc;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: t(held ? "SDE.warband.morale.held" : "SDE.warband.morale.failed", { warband: actor.name, dc, lead: leading ? t("SDE.warband.morale.leading") : "" }),
  });
  if (held) return;
  const chance = core.routChance(st.upgrades);
  const rout = await new Roll("1d6").evaluate();
  const routs = rout.total <= chance;
  await rout.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: t(routs ? "SDE.warband.morale.routed" : "SDE.warband.morale.stands", { warband: actor.name, chance }),
  });
  if (!routs) return;
  await replaceModuleFlag(actor, WARBAND_FLAG, { ...warbandState(actor), routed: true });
  await actor._setDefeated?.();
}

/** The note a warband's attack card carries: the area it fills and the dice it may split. */
function noteAttackCard(message, html) {
  if (!isAttackCard(message)) return;
  const attacker = actorFromUuidSync(message.flags.shadowdark.rollConfig.actorUuid);
  if (attacker?.type !== TYPE || html.querySelector(".sde-warband-note")) return;
  const note = document.createElement("div");
  note.className = "sde-warband-note";
  note.textContent = t("SDE.warband.areaNote");
  (html.querySelector(".message-content") ?? html).append(note);
}

let TYPE = null;

/** Hooks. Must run in `init`. */
export function registerWarbandCombat(type) {
  TYPE = type;
  // Initiative: a warband takes its commander's, on the active GM, whenever either changes or it joins.
  Hooks.on("createCombatant", (combatant) => {
    if (isActiveGM() && combatant.actor?.type === type) enqueue(() => followInitiative(combatant));
  });
  Hooks.on("updateCombatant", (combatant, changes) => {
    if (isActiveGM() && "initiative" in (changes ?? {})) enqueue(() => syncInitiative(combatant));
  });

  // Morale: every client keeps each warband's last HP, so the active GM knows
  // whether a change was a hit and from where; it alone rolls.
  const seen = new Map();
  Hooks.once("ready", () => { for (const a of game.actors) if (a.type === type) seen.set(a.uuid, hpOf(a)); });
  Hooks.on("createActor", (a) => { if (a.type === type) seen.set(a.uuid, hpOf(a)); });
  Hooks.on("updateActor", (actor, changes) => {
    if (actor.type !== type || changes?.system?.attributes?.hp?.value === undefined) return;
    const before = seen.get(actor.uuid) ?? Number(actor.system.attributes.hp.max ?? 0);
    const after = hpOf(actor);
    seen.set(actor.uuid, after);
    if (!isActiveGM() || !core.moraleTriggered(before, after, actor.system.attributes.hp.max)) return;
    // Only in a fight: morale is a battle rule, not a sheet edit's.
    const fighting = game.combats.some((c) => c.active && c.combatants.some((cb) => cb.actorId === actor.id));
    // On the one warband queue, with the sheet's and the upkeep's writes (#284 review): a rout never overwrites them.
    if (fighting) warbandWrites(() => moraleCheck(actor)).catch((err) => console.error(`${MODULE_ID} | warband morale`, err));
  });

  Hooks.on("renderChatMessageHTML", noteAttackCard);

  // A warband retraining its upgrades can't fight yet (#204): its attack is stopped, and the GM told why.
  Hooks.on("SD-NPC-Attack", (config) => {
    const actor = actorFromUuidSync(config?.actorUuid);
    if (actor?.type !== type) return true;
    // Retraining, it can't fight until the week is up (#204): the attack is stopped (false cancels it), with a warning.
    const until = warbandState(actor).retrainingUntil;
    if (!(until > game.time.worldTime)) return true;
    ui.notifications.warn(t("SDE.warband.notify.retraining", { warband: actor.name }));
    return false;
  });
}

