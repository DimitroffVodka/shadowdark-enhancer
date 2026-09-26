/**
 * Shadowdark Enhancer — Hunter Mode (core rulebook p.111): defeated monsters
 * give XP. Setting `modeHunterXp`, in the Modes of Play window (#178).
 *
 * When a combat ends, the active GM counts every NPC combatant still down:
 * marked defeated, or at 0 HP, which is how a monster killed from its sheet
 * or HP bar ends up without Shadowdark Extras (the system only marks defeated
 * through applyDamage; the crawl strip reads 0 HP the same way). It is the
 * state at the end, so a monster that got back up does not count and toggling
 * it during the fight cannot pay twice. Friendly combatants (summons,
 * hirelings) and hidden ones pay nothing, as Chaos leaves hidden ones off its
 * card. It pays every PC
 * who was in the fight the full total, through PartyXP.award: one card per
 * combat, the "ready to level up" marker, and Session Recap's log via the
 * partyXpAwarded hook, all as for any other award. Full XP to each mirrors
 * treasure XP (core p.116). Monsters killed outside a combat are not counted.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { combatantEntry, isHiddenFromStrip } from "../crawl-strip/turn-skip-core.mjs";

/**
 * XP one defeated monster is worth: half its level, rounded down, except that
 * level 1 gives 1 (a house rule on top of the book's round-down; Patrick,
 * 2026-09-25). Level 0 or less, or no level, gives nothing.
 * @param {number} level
 * @returns {number}
 */
export function hunterXp(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n === 1 ? 1 : Math.floor(n / 2);
}

/**
 * What a finished combat pays. Pure over plain combatant records.
 * @param {Array<{type:string, name:string, level:number, defeated:boolean, actorId:string, friendly?:boolean, hidden?:boolean, dead?:boolean}>} combatants
 * @returns {{ total:number, monsters:Array<{name:string, count:number, xp:number}>, pcIds:string[] }}
 */
export function hunterAward(combatants = []) {
  const byName = new Map();
  let total = 0;
  const pcIds = new Set();
  for (const c of combatants) {
    // The dead (core's `dead` status, #181) earn nothing; the dying still do.
    if (c?.type === "Player" && c.actorId) { if (!c.dead) pcIds.add(c.actorId); continue; }
    if (c?.type !== "NPC" || !c.defeated || c.friendly || c.hidden) continue;
    const xp = hunterXp(c.level);
    if (!xp) continue;
    total += xp;
    const row = byName.get(c.name) ?? { name: c.name, count: 0, xp: 0 };
    row.count += 1; row.xp += xp;
    byName.set(c.name, row);
  }
  return { total, monsters: [...byName.values()], pcIds: [...pcIds] };
}

/** A combatant as hunterAward reads it. The token's actor keeps an unlinked monster's own level. */
function record(combatant) {
  const actor = combatant.actor ?? game.actors.get(combatant.actorId);
  return {
    type: actor?.type ?? null,
    name: combatant.name ?? actor?.name ?? "",
    level: actor?.system?.level?.value,
    defeated: !!(combatant.isDefeated ?? combatant.defeated) || isHiddenFromStrip(combatantEntry(combatant)),
    friendly: (combatant.token?.disposition ?? actor?.prototypeToken?.disposition) === CONST.TOKEN_DISPOSITIONS.FRIENDLY,
    hidden: !!combatant.hidden,
    dead: !!actor?.statuses?.has("dead"),
    actorId: actor?.isToken ? (actor.baseActor?.id ?? combatant.actorId) : (actor?.id ?? combatant.actorId),
  };
}

const isActiveGM = () => !!game.user?.isGM && game.users.activeGM?.id === game.user.id;

/**
 * Pay a finished combat's Hunter XP. GM-side; the hook below decides when.
 * @param {Combat} combat
 * @returns {Promise<object[]|null>}  PartyXP.award's per-actor results, or null when nothing was paid
 */
export async function payHunterXp(combat) {
  const { total, monsters, pcIds } = hunterAward(combat.combatants.contents.map(record));
  if (!total || !pcIds.length) return null;
  const list = new Intl.ListFormat(game.i18n.lang, { type: "unit" }).format(monsters.map((m) =>
    (m.count > 1 ? game.i18n.format("SDE.hunter.count", { name: m.name, count: m.count }) : m.name)));
  // Loaded here, not at the top: party-xp.mjs builds an ApplicationV2 at load,
  // and the pure half of this file is tested under node.
  const { PartyXP } = await import("../party-xp/party-xp.mjs");
  return PartyXP.award(total, { actorIds: pcIds, label: game.i18n.format("SDE.hunter.label", { monsters: list }) });
}

export function init() {
  Hooks.on("deleteCombat", (combat) => {
    if (!isActiveGM() || game.settings.get(MODULE_ID, "modeHunterXp") !== true) return;
    payHunterXp(combat).catch((err) => console.error(`${MODULE_ID} | Hunter XP`, err));
  });
}
