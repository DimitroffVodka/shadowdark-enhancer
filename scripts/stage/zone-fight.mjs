/**
 * Shadowdark Enhancer — Stage zone fight, Foundry side: one global Combat of
 * tokenless combatants in Close/Near/Far, foes as cloned actors, and the
 * cleanup when the Combat is deleted. Every service is GM-only unless noted.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { worldActorFor } from "../shared/token-placement.mjs";
import { lootSettled } from "../loot/loot-drops.mjs";
import { Party } from "../party/party.mjs";
import { registerZoneBoard } from "./zone-board.mjs";
import { canMoveZone, cloneActorData, cloneNames, foeZoneFor, isZoneFight, normalizeZone, stepZone, zoneFightOf } from "./zone-core.mjs";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const notify = (level, key) => ui.notifications?.[level](L(key));

/** True (after a notice) when the user may not do GM-only work. */
function refuseUnlessGM() {
  if (game.user?.isGM) return false;
  notify("warn", "SDE.stage.zone.gmOnly");
  return true;
}

const flagsOf = (doc) => doc?.flags?.[MODULE_ID] ?? {};

/** A foe is one of this module's clones or a hostile prototype. */
function isFoe(combatant) {
  const actor = combatant?.actor;
  if (flagsOf(actor).zoneClone) return true;
  return actor?.prototypeToken?.disposition === (globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1);
}

export const findZoneFight = () => Array.from(game.combats ?? []).find(isZoneFight) ?? null;

/** The native party's members, else the Player characters of active users. */
function partyActors() {
  const party = Party.selected();
  const fromParty = party ? Party.rows(party).map((r) => r.actor).filter(Boolean) : [];
  const actors = fromParty.length ? fromParty : Array.from(game.users ?? []).filter((u) => u.active && u.character).map((u) => u.character);
  return [...new Map(actors.map((a) => [a.id, a])).values()];
}

export async function startZoneFight({ foes = [], source = "" } = {}) {
  if (refuseUnlessGM()) return null;
  if (findZoneFight()) { notify("warn", "SDE.stage.zone.startRunning"); return null; }
  const combat = await Combat.create({
    scene: null,
    active: true,
    flags: { [MODULE_ID]: { noAutoEnroll: true, zoneFight: { id: foundry.utils.randomID(), at: Date.now(), clones: [], source } } },
  });
  if (!combat) return null;
  const pcs = partyActors();
  if (pcs.length) {
    await combat.createEmbeddedDocuments("Combatant", pcs.map((a) => ({ actorId: a.id, flags: { [MODULE_ID]: { zone: "close" } } })));
  }
  for (const foe of foes) await addFoe(combat, foe);
  return combat;
}

/** The rolled encounter's creature, `count` clones of it in the band the distance roll gives (none: near). */
export async function startZoneFightFromEncounter(card) {
  if (refuseUnlessGM()) return null;
  const source = card?.uuid ? await fromUuid(card.uuid) : null;
  if (!source) { notify("warn", "SDE.stage.zone.noSource"); return null; }
  const count = Math.max(1, Math.floor(Number(card.count)) || 1);
  return startZoneFight({ foes: [{ uuid: card.uuid, count, zone: foeZoneFor(card.distanceRoll) }], source: "encounter" });
}

async function foeFolder() {
  const found = Array.from(game.folders ?? []).find((f) => f.type === "Actor" && f.flags?.[MODULE_ID]?.zoneFoes === true);
  return found ?? Folder.create({ name: L("SDE.stage.zone.folderName"), type: "Actor", flags: { [MODULE_ID]: { zoneFoes: true } } });
}

// One add at a time: each reads the clone list, the folder and the taken names fresh.
let addQueue = Promise.resolve();
const enqueue = (task) => {
  const run = addQueue.then(task);
  addQueue = run.catch(() => {});
  return run;
};

/** Clone `count` of the foe at `uuid` into `combat`; returns { actors, combatants } or null (nothing kept). */
export function addFoe(combat, opts = {}) {
  if (refuseUnlessGM()) return Promise.resolve(null);
  return enqueue(() => addFoeNow(combat, opts));
}

async function addFoeNow(combat, { uuid, count = 1, zone = "near" } = {}) {
  const fight = zoneFightOf(game.combats?.get?.(combat.id) ?? combat);
  if (!fight) return null;
  const world = await worldActorFor(uuid ? await fromUuid(uuid) : null);
  if (!world) { notify("warn", "SDE.stage.zone.noSource"); return null; }

  const actors = [];
  let combatants = [];
  try {
    const folder = await foeFolder();
    const taken = new Set(Array.from(game.actors ?? []).map((a) => a.name));
    for (const name of cloneNames(world.name, count, taken, L("SDE.stage.zone.foeName"))) {
      const actor = await Actor.create(cloneActorData(world.toObject(), { name, folder: folder.id, fightId: fight.id }));
      if (!actor) throw new Error(`clone ${name} was not created`);
      actors.push(actor);
    }
    combatants = await combat.createEmbeddedDocuments("Combatant", actors.map((a) => ({ actorId: a.id, flags: { [MODULE_ID]: { zone: normalizeZone(zone) } } })));
    // Read fresh: a second add may have recorded clones since `combat` was handed in.
    const now = zoneFightOf(game.combats?.get?.(combat.id) ?? combat) ?? fight;
    await replaceModuleFlag(game.combats?.get?.(combat.id) ?? combat, "zoneFight", {
      id: fight.id, at: now.at, source: now.source ?? "", clones: [...now.clones, ...actors.map((a) => a.id)],
    });
    return { actors, combatants };
  } catch (err) {
    console.error(`${MODULE_ID} | zone fight: adding a foe failed`, err);
    notify("error", "SDE.stage.zone.addFoeFailed");
    // Only what THIS call made, by exact id.
    const cids = combatants.map((c) => c.id);
    if (cids.length) await combat.deleteEmbeddedDocuments("Combatant", cids).catch((e) => console.error(`${MODULE_ID} | zone fight cleanup`, e));
    for (const actor of actors) await actor.delete().catch((e) => console.error(`${MODULE_ID} | zone fight cleanup`, e));
    return null;
  }
}

/**
 * One band closer or farther. A player's write is a combatant flag update by an
 * actor owner: core's Combatant#canUpdate allows an owner `flags` (and `initiative`,
 * `defeated`, `system`) on their own combatant, nothing else.
 */
export async function moveZone(combatant, dir) {
  const allowed = canMoveZone({ isGM: !!game.user?.isGM, ownsActor: !!combatant?.actor?.isOwner, isFoe: isFoe(combatant) });
  if (!allowed) { notify("warn", "SDE.stage.zone.moveRefused"); return null; }
  const from = normalizeZone(flagsOf(combatant).zone);
  const next = stepZone(from, dir);
  if (next !== from) await replaceModuleFlag(combatant, "zone", next, {}, {});
  return next;
}

/** Positive damages, negative heals; always through the system so temp HP, defeat and dying follow. */
export async function applyZoneDamage(combatant, amount) {
  const n = Number(amount);
  const allowed = canMoveZone({ isGM: !!game.user?.isGM, ownsActor: !!combatant?.actor?.isOwner, isFoe: isFoe(combatant) });
  if (!allowed || !Number.isFinite(n) || !combatant?.actor) { notify("warn", "SDE.stage.zone.damageRefused"); return null; }
  await combatant.actor.applyDamage(n);
  return n;
}

export async function toggleDefeated(combatant) {
  if (refuseUnlessGM()) return null;
  const next = !combatant.defeated;
  await combatant.update({ defeated: next });
  return next;
}

/** Delete the Combat first; `deleteCombat` readers need the clones alive, and the hook below removes them. */
export async function endZoneFight(combat) {
  if (refuseUnlessGM()) return false;
  await combat.delete();
  return true;
}

/** Ask first (the safe answer is No), then end the fight. */
export async function confirmEndZoneFight(combat) {
  if (refuseUnlessGM()) return false;
  const ok = await foundry.applications.api.DialogV2.confirm({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: L("SDE.stage.zone.endTitle") },
    content: `<p>${L("SDE.stage.zone.endQuestion")}</p>`,
    rejectClose: false,
  });
  return ok ? endZoneFight(combat) : false;
}

/** Runs after the Combat is gone: wait for loot, then delete the recorded clones by exact id. */
export async function cleanZoneClones(combat) {
  if (!isActiveGM()) return;
  const fight = zoneFightOf(combat);
  if (!fight) return;
  // Hooks run in registration order; let the loot hook register its promise first.
  await new Promise((r) => setTimeout(r, 0));
  await lootSettled(combat.id);
  for (const id of fight.clones) {
    try {
      const actor = game.actors.get(id);
      if (!actor || flagsOf(actor).zoneClone !== fight.id) continue;
      await actor.delete();
    } catch (err) {
      console.error(`${MODULE_ID} | zone fight: could not delete clone ${id}`, err);
    }
  }
}

export function registerZoneFight() {
  Hooks.on("deleteCombat", (combat) => { cleanZoneClones(combat); });
  registerZoneBoard();
}
