/**
 * Shadowdark Enhancer — Grinder Mode rest (Foundry-bound; the rules are in grinder-core.mjs)
 *
 * The native camping rest calls into here when Grinder is on: the settings, the
 * hit dice roll, and the player's pick of which lost spells come back.
 *
 * THE PICK NEVER HOLDS THE REST. The rest rolls the 1d4, brings back what the
 * roll covers, and finishes; a pick for the rest is asked afterwards. The
 * owning player is reached with a user query in the GM→player direction (the
 * same trust rule as the stat-damage save in stat-riders.mjs). No connected
 * owner, a closed dialog, a stale tab or the timeout fall back to the GM's own
 * client, and if the GM closes that too the first lost spells come back, so a
 * character is never left short.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM, registerQuery } from "../shared/gm-relay.mjs";
import { actorFromUuid } from "../shared/attack-card.mjs";
import { esc } from "../shared/esc.mjs";
import { StatDamage } from "../stat-damage/stat-damage.mjs";
import { clampHitDice, fillPick, hitDiceFormulas, overflowOf, spellRegain } from "./grinder-core.mjs";

/** GM → owning player: "choose which lost spells come back". */
export const PICK_QUERY = `${MODULE_ID}.grinderSpellPick`;

/** How long the player has to choose before the GM's client does. */
const PICK_TIMEOUT_MS = 120_000;

/** A world setting, or undefined when it is not registered (a test, an early load). */
function read(namespace, key) {
  try { return game.settings.get(namespace, key); } catch { return undefined; }
}

export const grinderOn = () => !!read(MODULE_ID, "modeGrinder");
export const grinderHitDice = () => clampHitDice(read(MODULE_ID, "modeGrinderHitDice"));
/** Damage past 0 HP becomes CON damage: an option of Grinder, so it needs Grinder on. */
export const grinderOverflowCon = () => grinderOn() && !!read(MODULE_ID, "modeGrinderOverflowCon");

/**
 * Take Shadowdark Extras' Grinder settings once, for a world that already ran Grinder
 * there. After this the Enhancer's own settings are the only ones read.
 */
export async function seedGrinder() {
  if (!isActiveGM() || read(MODULE_ID, "grinderSeeded")) return;
  const mode = read("shadowdark-extras", "grinderMode");
  if (mode !== undefined) {
    if (mode) await game.settings.set(MODULE_ID, "modeGrinder", true);
    await game.settings.set(MODULE_ID, "modeGrinderHitDice", clampHitDice(read("shadowdark-extras", "grinderHitDice")));
  }
  await game.settings.set(MODULE_ID, "grinderSeeded", true);
}

/**
 * Roll the character's class hit dice for the rest (Stout rolls each with advantage) and post the roll.
 * @returns {Promise<?number>} the total, or null when the character has no class die to roll.
 */
export async function rollGrinderHp(actor) {
  const die = actor.items.find((i) => i.type === "Class")?.system?.hitPoints;
  const advantage = (actor.system?._getActiveEffectKeys?.("system.roll.hp.advantage", 0)?.value ?? 0) > 0;
  const formulas = hitDiceFormulas(grinderHitDice(), die, advantage);
  if (!formulas.length) return null;
  const roll = await new Roll(formulas.join(" + ")).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: esc(game.i18n.format("SDE.camping.grinderHp", { name: actor.name })),
  });
  return roll.total;
}

/**
 * The rest's 1d4 for lost spells, rolled and posted once: which lost spells come back by themselves
 * (`auto`) and how many are the player's pick (`pick`). Nothing is rolled when no spell is lost.
 */
export async function grinderSpells(actor) {
  const lost = actor.items.filter((i) => i.type === "Spell" && i.system.lost).map((i) => i.id);
  if (!lost.length) return { roll: 0, lost, auto: [], pick: 0 };
  const roll = await new Roll("1d4").evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: esc(game.i18n.format("SDE.camping.grinderSpellRoll", { name: actor.name })),
  });
  return { roll: roll.total, lost, ...spellRegain(lost, roll.total) };
}

/** The choice dialog, on whichever client shows it. Resolves to the chosen item ids, or null when closed. */
async function chooseSpells(actor, spells, count) {
  const rows = spells.map((s) => `<label class="sde-grinder-spell"><input type="checkbox" name="spell" value="${esc(s.id)}"> ${esc(s.name)}</label>`).join("");
  return foundry.applications.api.DialogV2.prompt({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: game.i18n.format("SDE.camping.grinderPickTitle", { name: actor.name }) },
    content: `<p>${esc(game.i18n.format("SDE.camping.grinderPick", { count }))}</p>${rows}`,
    ok: {
      label: "SDE.camping.grinderPickOk",
      callback: (_event, button) => [...button.form.querySelectorAll("input[name=spell]:checked")].map((el) => el.value),
    },
    rejectClose: false,
  });
}

/** Player side: only a GM may ask, and only for a character this client owns. */
async function handlePickQuery(data, user) {
  if (!user?.isGM) return { ok: false };
  const actor = await actorFromUuid(data?.actorUuid);
  const ids = Array.isArray(data?.ids) ? data.ids.filter((id) => actor?.items.get(id)?.system?.lost) : [];
  const count = Math.floor(Number(data?.count));
  if (!actor?.isOwner || !ids.length || !(count > 0)) return { ok: false };
  const picked = await chooseSpells(actor, ids.map((id) => actor.items.get(id)), count);
  return picked ? { ok: true, picked } : { ok: false };
}

/**
 * Ask who plays `actor` which `count` of its lost spells come back, then bring them back.
 * Called after the rest has finished; it never throws into the caller's rest.
 */
export async function pickLostSpells(actor, lostIds, count) {
  const ids = lostIds.filter((id) => actor.items.get(id)?.system?.lost);
  if (!ids.length || !(count > 0)) return [];
  const owners = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  const player = owners.find((u) => u.character?.id === actor.id) ?? owners[0];
  let chosen = null;
  if (player) {
    const reply = await player.query(PICK_QUERY, { actorUuid: actor.uuid, ids, count }, { timeout: PICK_TIMEOUT_MS }).catch(() => null);
    if (reply?.ok) chosen = reply.picked;
  }
  chosen ??= await chooseSpells(actor, ids.map((id) => actor.items.get(id)), count);
  const picked = fillPick(chosen, ids, count).filter((id) => actor.items.get(id)?.system?.lost);
  for (const id of picked) await actor.items.get(id).update({ "system.lost": false });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${esc(game.i18n.format("SDE.camping.grinderSpells", { name: actor.name, spells: picked.map((id) => actor.items.get(id).name).join(", ") }))}</p>`,
  });
  return picked;
}

/**
 * The system's applyDamage, with a hit's overflow past 0 HP put on CON as stat damage (Grinder's
 * option). This wraps the system's own method, so it sees the damage that reaches HP; the temp HP
 * wrapper goes around it (registerGrinder is called before registerTempHp, and both wrap on `ready`).
 * CON 0 is death through the stat-damage hook, and dying runs as it always does.
 */
export async function damageWithOverflow(original, damage, multiplier) {
  const amount = Math.floor(parseInt(damage) * multiplier);
  const over = amount > 0 && this.type === "Player" && grinderOverflowCon() ? overflowOf(amount, this.system?.attributes?.hp?.value) : 0;
  const result = await original.call(this, damage, multiplier);
  if (over > 0 && await StatDamage.apply(this, "con", over) !== null) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<p>${esc(game.i18n.format("SDE.camping.grinderOverflow", { name: this.name, amount: over }))}</p>`,
    });
  }
  return result;
}

export function registerGrinder() {
  registerQuery(PICK_QUERY, (data, { user } = {}) => handlePickQuery(data, user));
  Hooks.once("ready", () => {
    const prototype = CONFIG.Actor.documentClass.prototype, original = prototype.applyDamage;
    prototype.applyDamage = function (damage, multiplier = 1) { return damageWithOverflow.call(this, original, damage, multiplier); };
  });
  Hooks.once("ready", () => { void seedGrinder().catch((error) => console.warn(`${MODULE_ID} | Grinder seed`, error)); });
}
