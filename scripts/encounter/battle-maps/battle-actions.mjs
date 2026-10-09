/**
 * Shadowdark Enhancer — encounter battle maps: what the buttons do.
 *
 * The clock HUD's Encounter panel and the posted encounter card both end here. One flow sets a battle up
 * (openBattleMap: the terrain's default map, or the picker's), and the panel's other buttons bring the table,
 * change the map and return to travel. The parts they reach (the scene and battle in encounter-battle.mjs, the
 * library, the picker, the preload readout) are imported when first needed, so one of them missing or broken costs
 * the battle buttons and nothing else. What they decide is in battle-actions-core.mjs.
 *
 * This file and its core are not among those parts: overland-bar.mjs and encounter-draw.mjs import them when the
 * module loads, with constants.mjs and encounter-preload-core.mjs under them. All four are pure at load, so only a
 * packaging error (one of them absent from the install) could stop the module loading over them.
 *
 * Returning from a fight also continues the travel, the way Continue does (see returnToTravel); set-up, bringing the
 * table and changing the map leave Overland's held encounter and the clock alone.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { esc } from "../../shared/esc.mjs";
import { L as t } from "../../shared/i18n.mjs";
import { isNight, partyHex, terrainKey, worldClock } from "../encounter-terrain.mjs";
import { BATTLE_STATUS, SETTINGS } from "./constants.mjs";
import {
  canBattle, needsConfirm, needsPick, pickAnswer, pickerArgs, readStash, recordOf, setUpArgs, stillLoading,
} from "./battle-actions-core.mjs";

/**
 * The table's conditions: night by the fixed hours the encounter tables use, whether Overland has tonight's camp made, and
 * whether the party is travelling (the battle keeps that, to put the travel back when it is over).
 */
function liveConditions() {
  const overland = game.shadowdarkEnhancer?.overland;
  return { night: isNight(worldClock().hour), camping: !!overland?.state?.()?.camp, travelling: !!overland?.isActive?.() };
}

/** Bringing the table before everyone has the map: who is still loading, and whether to go ahead anyway. */
function confirmLate(names) {
  return foundry.applications.api.DialogV2.confirm({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.encounterMaps.hud.confirm.title"), icon: "fa-solid fa-users" },
    content: `<p>${esc(t("SDE.encounterMaps.hud.confirm.body"))}</p><p>${esc(t("SDE.encounterMaps.preload.summary.pending", { names: names.join(", ") }))}</p>`,
    yes: { label: t("SDE.encounterMaps.hud.confirm.yes") },
    no: { label: t("SDE.encounterMaps.hud.confirm.no"), default: true },
    rejectClose: false,
  });
}

/** What the flows reach into. Tests pass their own over these. */
const live = {
  battle: async () => (await import("./encounter-battle.mjs")).BattleMaps,
  picker: async () => (await import("./battle-map-picker.mjs")).BattleMapPicker,
  maps: () => import("./encounter-maps.mjs"),
  preload: () => import("./encounter-preload.mjs"),
  conditions: liveConditions,
  prefs: () => { try { return game.settings.get(MODULE_ID, SETTINGS.prefs); } catch { return {}; } },
  confirm: confirmLate,
  continueTravel,
};

/**
 * Carry the travel on after a fight. Bringing the table activated a scene that is not a hex map, and where the module
 * follows the active scene that turned the travel into a crawl, which nothing turns back: the party was left on the hex
 * map with no travel, no time and no checks. A party that was travelling is put back (only from a crawl: travel the GM
 * ended is theirs). Then what the Continue button does: the encounter that stopped the clock is cleared and the advance it
 * stopped is finished. Nothing held (a battle made from a posted card, an encounter already continued) is nothing to do.
 * @param {{travelling?:boolean}} [battle]  the battle's own record of whether the party was travelling
 * @param {{crawl?:object, overland?:object}} [modules]  the crawl state and Overland, instead of the real ones (tests)
 * @returns {Promise<{ok:boolean, error?:string}|null>}
 */
export async function continueTravel({ travelling = false } = {}, modules = {}) {
  const CrawlState = modules.crawl ?? (await import("../../crawl-strip/crawl-state.mjs")).CrawlState;
  const overland = modules.overland ?? await import("../../overland/overland.mjs");
  // The combat's end hands the mode back a moment after it is deleted.
  for (let i = 0; i < 20 && CrawlState.mode === "combat"; i++) await new Promise((resolve) => setTimeout(resolve, 150));
  if (travelling && CrawlState.mode === "crawl") await CrawlState.startOverland();
  const held = overland.overlandState();
  return held.pending || held.encounter ? overland.resume() : null;
}

/** Run a flow; one that throws (a missing file, a refusal that threw) tells the GM and ends, rather than as an unhandled click. */
async function guarded(run) {
  try {
    return await run();
  } catch (err) {
    console.error(`${MODULE_ID} | battle map`, err);
    ui.notifications?.error(t("SDE.encounterMaps.hud.failed"));
    return null;
  }
}

/**
 * Where the party stands, for a battle or for a card that outlives the moment. While Overland travels that is its
 * hex and the scene its travel token is on (the encounter was rolled there); otherwise the viewed map's party hex.
 * @returns {{terrain:string|null, hexNum:number|null, originSceneId:string|null}}
 */
export function partyContext() {
  const overland = game.shadowdarkEnhancer?.overland;
  let hex = null;
  let originSceneId = globalThis.canvas?.scene?.id ?? null;
  try {
    if (overland?.isActive?.()) {
      const state = overland.state();
      hex = state.hex;
      originSceneId = (state.tokenUuid ? fromUuidSync(state.tokenUuid)?.parent?.id : null) ?? originSceneId;
    }
  } catch { /* the travel token is gone: the viewed map answers */ }
  // A card must still post when the canvas cannot say: no terrain, and the picker asks.
  try { hex ??= partyHex(); } catch { hex = null; }
  return { terrain: terrainKey(hex?.terrain) || null, hexNum: Number.isInteger(hex?.num) ? hex.num : null, originSceneId };
}

/** The setup in flight, if any, whichever button began it: see openBattleMap. */
let opening = null;

/**
 * Set a battle up for a monster encounter (the one flow behind both Battle map buttons): the terrain's default map,
 * or the picker's when the GM chose, the terrain is unknown, or the library has no default for it. A picker closed
 * ends quietly. Nothing is pulled over: the scene is staged and viewed by this GM alone.
 *
 * One at a time: the HUD's button and the card's guard themselves separately, so pressing one while the other's
 * setup runs would pass the "no battle yet" check twice before either had written a battle. A call made while one is
 * in flight is that one's answer, and sets nothing up of its own.
 * @param {{enc:object, terrain?:string|null, hex?:number|null, choose?:boolean, originSceneId?:string}} opts
 *   hex: the hex's number; originSceneId: the scene to come back to (default: the viewed one)
 * @param {object} [io]  what to reach into instead of the real parts (tests)
 * @returns {Promise<object|null>} BattleMaps.setUp's answer (whichever shape it takes), or null when nothing was set up
 */
export async function openBattleMap(opts = {}, io = {}) {
  if (!game.user?.isGM || !canBattle(opts.enc)) return null;
  opening ??= setUpFrom(opts, { ...live, ...io }).finally(() => { opening = null; });
  return opening;
}

async function setUpFrom({ enc, terrain = null, hex = null, choose = false, originSceneId = globalThis.canvas?.scene?.id ?? null }, x) {
  return guarded(async () => {
    const BattleMaps = await x.battle();
    if (recordOf(await BattleMaps.current())) {
      ui.notifications?.warn(t("SDE.encounterMaps.hud.running"));
      return null;
    }
    const key = terrainKey(terrain) || null;
    const now = await x.conditions();
    let hasDefault = false;
    if (key) {
      const maps = await x.maps();
      hasDefault = !!maps.resolveDefaultMap(key, maps.normalizePrefs(await x.prefs()));
    }
    let pick = null;
    if (needsPick({ choose, terrain: key, hasDefault })) {
      pick = await (await x.picker()).pick({ terrain: key, ...now });
      if (!pick) return null;
    }
    return BattleMaps.setUp(setUpArgs({ enc, terrain: key, hex, originSceneId, ...now, pick }));
  });
}

/** Change map (while staged): the picker, opened on the battle's own terrain and look, and the battle's tokens move. */
export async function changeBattleMap({ battle }, io = {}) {
  const x = { ...live, ...io };
  if (!game.user?.isGM || !battle?.id) return null;
  return guarded(async () => {
    const seed = pickerArgs(battle, await x.conditions());
    const pick = await (await x.picker()).pick(seed);
    if (!pick) return null;
    return (await x.battle()).changeMap(battle.id, pickAnswer(pick, seed));
  });
}

/** Bring the table: everyone to the battle map, and the combat made. Early, it asks first, naming who is still loading. */
export async function bringTheTable({ battle, preload = null }, io = {}) {
  const x = { ...live, ...io };
  if (!game.user?.isGM || !battle?.id) return null;
  return guarded(async () => {
    if (needsConfirm(preload) && !(await x.confirm(stillLoading(preload)))) return null;
    return (await x.battle()).bringTable(battle.id);
  });
}

/** What a kept battle is called in Saved encounters: "3 Wolf (Forest Woods)". */
const savedLabel = (battle) => t("SDE.encounterMaps.hud.savedLabel", { count: battle.encounter?.count ?? 1, name: battle.encounter?.name ?? "", map: battle.label ?? "" });

/**
 * Return to travel, from a staged or a live battle: the origin scene again, this battle's tokens down, its combat
 * ended; `keep` first saves a copy with the tokens. From a battle whose table was brought (the fight is over) the
 * travel carries on as if the GM had pressed Continue: the held encounter stopped the clock, and until it is cleared
 * the party moves on the hex map and no time passes. A battle that was only set up leaves the encounter held.
 */
export async function returnToTravel({ battle, keep = false }, io = {}) {
  const x = { ...live, ...io };
  if (!game.user?.isGM || !battle?.id) return null;
  return guarded(async () => {
    const done = await (await x.battle()).returnToTravel(battle.id, { keep: !!keep, label: keep ? savedLabel(battle) : undefined });
    if (done && battle.status === BATTLE_STATUS.live) {
      // The battle is down either way: a travel that cannot be continued says so and leaves Continue to the GM.
      try {
        const result = await x.continueTravel({ travelling: !!battle.travelling });
        if (result?.ok === false) ui.notifications?.warn(result.error);
      } catch (err) {
        console.error(`${MODULE_ID} | battle map: travel could not be continued`, err);
        ui.notifications?.warn(t("SDE.encounterMaps.hud.continueFailed"));
      }
    }
    return done;
  });
}

// ─── What the HUD reads ─────────────────────────────────────────────────────

/**
 * The parts the HUD reads on every redraw, loaded once. The readout may go without (the preload can be off, and its
 * file missing costs only the readout); the battle and the library may not, and then the HUD has no battle controls.
 * @returns {Promise<{BattleMaps:object, getEncounterMap:Function, preloadSnapshot:Function, onPreloadChange:Function}|null>}
 */
export async function loadBattleParts(io = {}) {
  const x = { ...live, ...io };
  try {
    const [BattleMaps, maps, preload] = await Promise.all([x.battle(), x.maps(), x.preload().catch(() => ({}))]);
    return {
      BattleMaps,
      getEncounterMap: maps.getEncounterMap,
      preloadSnapshot: preload.preloadSnapshot ?? (() => null),
      onPreloadChange: preload.onPreloadChange ?? (() => () => {}),
    };
  } catch (err) {
    console.warn(`${MODULE_ID} | battle maps are not available`, err);
    return null;
  }
}

/**
 * The running battle as the panel reads it: BattleMaps.current()'s record, with its map's name (a world scene's own
 * name when it is not a library map) and its combat: `combat` is its state, or null; `combatEnded` says the battle
 * made one and it is gone (ended from the tracker or the crawl bar), which the panel words differently from one that
 * is merely not started. Null when there is no battle, or it is done.
 */
export function describeBattle(answer, { getEncounterMap, scenes = game.scenes, combats = game.combats } = {}) {
  const record = recordOf(answer);
  if (!record || record.status === BATTLE_STATUS.done) return null;
  const map = record.mapId ? getEncounterMap?.(record.mapId) : null;
  const known = !!record.combatId && typeof combats?.get === "function";
  const combat = known ? combats.get(record.combatId) : null;
  return {
    ...record,
    label: map ? t(map.labelKey) : (scenes?.get?.(record.sceneId)?.name ?? ""),
    combat: combat ? { started: !!combat.started, round: combat.round ?? 0 } : null,
    combatEnded: known && !combat,
  };
}

// ─── The posted card ────────────────────────────────────────────────────────

/**
 * Wire the Battle map button of a rendered encounter card. A GM's click sets the battle up from what the card kept;
 * anyone else's client takes the button out (the card is the same HTML for everyone), and so does a card with no
 * stash, such as one posted before this feature.
 */
export function wireBattleCard(message, html, io = {}) {
  const buttons = [...(html?.querySelectorAll?.("[data-sde-battle-map]") ?? [])];
  if (!buttons.length) return;
  const stash = readStash(message?.flags?.[MODULE_ID]?.encounterCard);
  if (!game.user?.isGM || !stash) {
    for (const button of buttons) (button.closest?.(".cc-foot") ?? button).remove();
    return;
  }
  for (const button of buttons) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      // Setting a scene up takes a moment: a second click while it runs would race the first.
      if (button.disabled) return;
      button.disabled = true;
      try {
        await openBattleMap({ enc: stash.encounter, terrain: stash.terrain, hex: stash.hexNum, originSceneId: stash.originSceneId ?? undefined }, io);
      } finally {
        button.disabled = false;
      }
    });
  }
}

let registered = false;

/** Wire every encounter card as it renders (D1 calls this once at `ready`). */
export function registerBattleChatButtons() {
  if (registered) return;
  registered = true;
  Hooks.on("renderChatMessageHTML", (message, html) => wireBattleCard(message, html));
}
