/**
 * Shadowdark Enhancer — the clock HUD's Encounter panel (#257, the demo's).
 *
 * A travel check that hits rolls quietly (encounter.check's `quiet`): nothing
 * reaches chat, and what it drew is held in Overland's `encounter` for the GMs.
 * This panel shows it: the check, the chain of tables it went through, the
 * creature and how many, and the distance, activity and reaction rolls. Post
 * to chat shows the players; Continue runs the rest of the clock. The chevron
 * folds the panel into a strip under the bar, which keeps Continue at hand.
 * The buttons are the clock HUD's (overland-bar.mjs handles their data-action;
 * the chevrons are its panel toggle, "open" "encounter").
 *
 * A creature's encounter also opens a battle map (docs/plans/encounter-battle-maps.md):
 * Battle map and Choose map... before one is set up; once it is, the section of its
 * state (battleSection), which the HUD's battle panel carries too, for the scenes
 * and the combat where the bar's clock is hidden.
 */

import { esc } from "../shared/esc.mjs";
import { dateParts } from "../time/time-core.mjs";
import { facetWords } from "../encounter/encounter-result.mjs";
import { BATTLE_STATUS } from "../encounter/battle-maps/constants.mjs";
import { allReady, barPercent, battleControls, canBattle, readoutSummary, readyArgs } from "../encounter/battle-maps/battle-actions-core.mjs";
import { PRELOAD_STATE_KEYS } from "../encounter/battle-maps/encounter-preload-core.mjs";
import { L as t } from "../shared/i18n.mjs";

const gold = (v) => `<span class="sde-hud-gold">${esc(v)}</span>`;
const key = (action, label, { cls = "", hint = "" } = {}) =>
  `<button type="button" class="sde-hud-key ${cls}" data-action="${action}"${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</button>`;
/** The chevron that folds the panel (open) or unfolds the strip: the HUD's toggle of the encounter panel. */
const chevron = (open) => {
  const label = t(open ? "SDE.clock.enc.fold" : "SDE.clock.enc.unfold");
  return `<button type="button" class="sde-hud-ib" data-action="open" data-id="encounter" aria-expanded="${open}" aria-label="${esc(label)}" data-tooltip="${
    esc(label)}"><i class="fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"}"></i></button>`;
};
/** A flavor line cut at a word to about `n` characters, for the strip. */
const shorten = (s, n = 48) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n) > 0 ? s.lastIndexOf(" ", n) : n)}…`);

/** A table in the chain, as a chip: its name, its dice and their roll (no-break spaces: a flex chip drops plain ones). */
const tableChip = (l) => `<span class="sde-hud-chip">${esc(l.name ?? "")}${
  l.roll !== null && l.roll !== undefined ? `\u00a0· ${esc(l.formula ?? "")}\u00a0${gold(l.roll)}` : ""}</span>`;

/** A battle's stage and the readout's summary line, in words (literal keys, so i18n-keys can see them). */
export const BATTLE_STATUS_WORD = { staged: "SDE.encounterMaps.hud.status.staged", live: "SDE.encounterMaps.hud.status.live" };
/** A readout row's state in words: the preload part's own list of them, a player who left included. */
const STATE_WORD = PRELOAD_STATE_KEYS;
const SUMMARY_WORD = {
  nobody: "SDE.encounterMaps.preload.summary.nobody",
  allReady: "SDE.encounterMaps.preload.summary.allReady",
  pending: "SDE.encounterMaps.preload.summary.pending",
};

/** One player's row of the preload readout: who, how far, and a thin bar. */
function readoutRow(row) {
  const state = Object.hasOwn(STATE_WORD, row.state) ? row.state : "waiting";
  const counted = row.total > 0 && (state === "loading" || state === "stalled");
  const word = counted
    ? t(state === "loading" ? "SDE.encounterMaps.preload.row.loading" : "SDE.encounterMaps.preload.row.stalled", { loaded: row.loaded ?? 0, total: row.total })
    : t(STATE_WORD[state]);
  return `<div class="sde-hud-pr sde-hud-pr-${state}"><span class="sde-hud-n" data-tooltip="${esc(row.name ?? "")}">${esc(row.name ?? "")}</span><span class="sde-hud-cap">${
    esc(word)}</span><span class="sde-hud-meter"><span style="width:${barPercent(row)}%"></span></span></div>`;
}

/** The readout: a row a player, then who is being waited on. Nothing when no preload ran. */
function readoutBlock(preload) {
  const summary = readoutSummary(preload);
  if (!summary) return "";
  return `<div class="sde-hud-readout">${(preload.rows ?? []).map(readoutRow).join("")}<span class="sde-hud-fl">${
    esc(t(SUMMARY_WORD[summary.kind], summary))}</span></div>`;
}

/** Bring the table, with how many have the map ("Ready 3/4") once a readout is running; green when all do. */
function bringKey(preload) {
  const ready = readyArgs(preload);
  return `<button type="button" class="sde-hud-key${allReady(preload) ? " sde-hud-ready" : ""}" data-action="bringTable" data-tooltip="${
    esc(t("SDE.encounterMaps.hud.bringHint"))}">${esc(t("SDE.encounterMaps.hud.bring"))}${
    ready ? `<span class="sde-hud-badge">${esc(t("SDE.encounterMaps.preload.readyLabel", ready))}</span>` : ""}</button>`;
}

/** The one line a live battle says: where the table is, and whether its combat is waiting, running or over. */
function liveLine(battle) {
  const name = battle.label ?? "";
  if (battle.combatEnded) return t("SDE.encounterMaps.hud.liveEnded", { name });
  return battle.combat?.started
    ? t("SDE.encounterMaps.hud.liveRound", { name, round: battle.combat.round })
    : t("SDE.encounterMaps.hud.live", { name });
}

/**
 * What a battle's panel shows by its stage (docs/plans/encounter-battle-maps.md): staged, the map and a row per
 * player loading it, then Bring the table and Change map; live, the one-line status. Either can return to travel,
 * with Keep this battle to save a copy of the map with its tokens first.
 * @param {{battle:object, preload?:object|null, keep?:boolean}} v  battle: describeBattle's; preload: preloadSnapshot's;
 *   keep: whether the checkbox is ticked (the bar redraws often, so it is kept there, not in the DOM)
 */
export function battleSection({ battle, preload = null, keep = false }) {
  const controls = battleControls(battle);
  const staged = battle.status === BATTLE_STATUS.staged;
  const line = staged
    ? `<span class="sde-hud-cap">${esc(t("SDE.encounterMaps.hud.mapLine", { name: battle.label ?? "" }))}</span><span class="sde-hud-fl">${esc(t("SDE.encounterMaps.hud.staged"))}</span>`
    : `<span class="sde-hud-fl">${esc(liveLine(battle))}</span>`;
  return `<div class="sde-hud-battle" data-status="${esc(battle.status)}">${line}${staged ? readoutBlock(preload) : ""}<div class="sde-hud-brow">${
    controls.bring ? bringKey(preload) : ""}${
    controls.change ? key("changeBattleMap", t("SDE.encounterMaps.hud.changeMap"), { cls: "sde-hud-ghost", hint: t("SDE.encounterMaps.hud.changeMapHint") }) : ""}${
    controls.back ? `<span class="sde-hud-end"><label class="sde-hud-keep" data-tooltip="${esc(t("SDE.encounterMaps.hud.keepHint"))}"><input type="checkbox" data-action="keepBattle"${keep ? " checked" : ""}><span>${
      esc(t("SDE.encounterMaps.hud.keep"))}</span></label>${
      key("returnToTravel", t("SDE.encounterMaps.hud.return"), { cls: staged ? "sde-hud-ghost" : "", hint: t("SDE.encounterMaps.hud.returnHint") })}</span>` : ""}</div></div>`;
}

/**
 * The foes, for the battle's own panel: the creature and how many, then the distance, activity and reaction that were
 * rolled for them, worded as the Encounter panel words them. The battle's record is where they come from (the held
 * encounter may be gone, a card's never was held), and a record from before it kept the activity and the reaction
 * shows what it has.
 */
function battleWho(battle) {
  const e = battle.encounter;
  if (!e?.name) return "";
  const words = facetWords({ distanceRoll: e.distanceRoll, activityRoll: e.activityRoll, reactionRoll: e.reactionRoll, reactionTotal: e.reactionRoll });
  const facet = (label, die, roll, word, cls = "") => (Number.isFinite(roll)
    ? `<div class="sde-hud-facet"><span class="sde-hud-cap">${esc(t(label))} · ${esc(die)} ${gold(roll)}</span><span class="sde-hud-v ${cls}">${esc(word)}</span></div>` : "");
  const facets = facet("SDE.encounter.facet.distance", "1d6", e.distanceRoll, words.distanceText)
    + facet("SDE.encounter.facet.activity", "2d6", e.activityRoll, words.activityText)
    + facet("SDE.encounter.facet.reaction", "2d6", e.reactionRoll, words.reactionText, `sde-reaction-${words.reactionBand}`);
  return `<div class="sde-hud-who"><div class="sde-hud-what"${e.uuid ? ` data-uuid="${esc(e.uuid)}"` : ""}>${e.img ? `<img src="${esc(e.img)}" alt="">` : ""}${
    gold(e.count || 1)}<span class="sde-hud-bl">${esc(e.name)}</span></div>${facets ? `<div class="sde-hud-facets">${facets}</div>` : ""}${
    words.reactionDoubleOnes && Number.isFinite(e.reactionRoll) ? `<span class="sde-hud-res">${esc(t("SDE.encounter.chat.doubleOnes"))}</span>` : ""}</div>`;
}

/**
 * The battle's own panel, for a GM: who the party is fighting, then the same section on its own, so the controls are
 * within reach where the clock is hidden (the battle's scene, a combat) and when no encounter is held any longer.
 */
export function battlePanel({ battle, preload = null, keep = false }) {
  return `<div class="sde-hud-panel sde-hud-battle-panel">
    <div class="sde-hud-ph"><span class="sde-hud-ttl">${esc(t("SDE.encounterMaps.hud.panel"))}</span><span class="sde-hud-cap">${
      esc(t(BATTLE_STATUS_WORD[battle.status] ?? BATTLE_STATUS_WORD.live))}</span></div>
    <div class="sde-hud-pb">${battleWho(battle)}${battleSection({ battle, preload, keep })}</div>
  </div>`;
}

/**
 * The encounter as the card and the panel word it: the facets at CHA +0
 * (the roller adjusts CHA and renown; the book rolls the reaction when the
 * party meets it).
 * @param {object} enc  Overland's `encounter`
 */
export function encounterCard(enc) {
  if (enc?.kind !== "monster") return { ...enc };
  return { ...enc, chaMod: 0, reactionTotal: enc.reactionRoll, ...facetWords({ ...enc, reactionTotal: enc.reactionRoll }) };
}

/**
 * The panel, for a GM.
 * @param {{enc:object, cal:object, battle?:object|null, preload?:object|null, keep?:boolean, battleMaps?:boolean}} v
 *   enc: Overland's `encounter`; cal: the calendar; battle: the running battle (describeBattle's), null for none;
 *   preload: its readout (preloadSnapshot's); keep: the Keep this battle checkbox; battleMaps: false when the
 *   battle maps could not be loaded, so the panel has no battle buttons
 */
export function encounterPanel({ enc, cal, battle = null, preload = null, keep = false, battleMaps = true }) {
  const c = encounterCard(enc);
  const battling = battleMaps && canBattle(c);
  const check = t(enc.half === "night" ? "SDE.overland.check.night" : "SDE.overland.check.day", { time: dateParts(cal, enc.at).time });
  const header = t("SDE.clock.enc.header", { step: enc.half === "night" ? 8 : 6, check, chance: enc.chance });
  const chain = enc.chain.map((l) => (l.category ? `<span class="sde-hud-cat">${esc(l.category)}</span>` : tableChip(l)))
    .join('<i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i>');
  let body;
  if (c.kind === "monster") {
    const facet = (label, die, roll, word, cls = "") => `<div class="sde-hud-facet"><span class="sde-hud-cap">${
      esc(t(label))} · ${esc(die)} ${gold(roll)}</span><span class="sde-hud-v ${cls}">${esc(word)}</span></div>`;
    body = `<div class="sde-hud-what"${c.uuid ? ` data-uuid="${esc(c.uuid)}"` : ""}><img src="${esc(c.img ?? "")}" alt="">${gold(c.count ?? 1)}<span class="sde-hud-bl">${esc(c.name ?? "")}</span></div>`
      + (c.countFormula ? `<span class="sde-hud-cap">${esc(t("SDE.clock.enc.appearing", { dice: c.countFormula }))}</span>` : "")
      + `<div class="sde-hud-facets">${facet("SDE.encounter.facet.distance", "1d6", c.distanceRoll, c.distanceText)}${
        facet("SDE.encounter.facet.activity", "2d6", c.activityRoll, c.activityText)}${
        facet("SDE.encounter.facet.reaction", "2d6", c.reactionRoll, c.reactionText, `sde-reaction-${c.reactionBand}`)}</div>`
      + (c.reactionDoubleOnes ? `<span class="sde-hud-res">${esc(t("SDE.encounter.chat.doubleOnes"))}</span>` : "");
  } else if (c.kind === "flavor") {
    body = (c.poi ? `<span class="sde-hud-cap">${esc(t("SDE.clock.enc.poi"))}</span>` : "") + `<p class="sde-hud-res">${esc(c.text ?? "")}</p>`;
  } else {
    body = `<p class="sde-hud-res">${esc(t(c.noTable ? "SDE.clock.enc.noTable" : "SDE.clock.enc.empty"))}</p>`;
  }
  const also = enc.also.map((a) => `<p class="sde-hud-fl">${esc(t("SDE.clock.enc.also", { table: a.name ?? "", text: a.text ?? "" }))}</p>`).join("");
  return `<div class="sde-hud-panel sde-hud-enc">
    <div class="sde-hud-ph sde-hud-ph-row"><span class="sde-hud-cap sde-hud-grow">${esc(header)}</span>${chevron(true)}</div>
    <div class="sde-hud-pb">
      <span class="sde-hud-bl sde-hud-big">${esc(t("SDE.encounter.chat.heading"))}</span>
      ${chain ? `<div class="sde-hud-chain">${chain}</div>` : ""}
      ${body}
      ${c.via ? `<span class="sde-hud-fl">${esc(c.via)}</span>` : ""}
      ${also}
      ${enc.interrupts ? `<span class="sde-hud-res">${esc(t("SDE.clock.enc.interrupts"))}</span>` : ""}
      <span class="sde-hud-fl">${esc(t("SDE.clock.enc.secret"))}</span>
    </div>
    ${battling && battle ? battleSection({ battle, preload, keep }) : ""}
    <div class="sde-hud-pf">
      ${c.kind === "empty" ? "" : key("postEncounter", t("SDE.clock.enc.post"), { hint: t("SDE.clock.enc.postHint") })}
      ${battling && !battle ? key("battleMap", t("SDE.encounterMaps.hud.battleMap"), { hint: t("SDE.encounterMaps.hud.battleMapHint") })
        + key("chooseBattleMap", t("SDE.encounterMaps.hud.chooseMap"), { cls: "sde-hud-ghost", hint: t("SDE.encounterMaps.hud.chooseMapHint") }) : ""}
      ${key("openRoller", t("SDE.clock.enc.roller"), { cls: "sde-hud-ghost", hint: t("SDE.clock.enc.rollerHint") })}
      <span class="sde-hud-grow"></span>
      ${key("resume", t("SDE.overland.resume"), { cls: "sde-hud-primary", hint: t("SDE.overland.resumeHint") })}
    </div>
  </div>`;
}

/**
 * The panel folded (#257): a strip under the bar, for a GM, while the
 * encounter is held. "Encounter · 14:00 · 3 Wolf" (or the point of interest's
 * text, shortened), the chevron that opens the panel again, and Continue. A
 * running battle map is marked.
 * @param {{enc:object, cal:object, battle?:object|null}} v  enc: Overland's `encounter`; cal: the calendar
 */
export function encounterStrip({ enc, cal, battle = null }) {
  let what;
  if (enc.kind === "monster") what = `${enc.count !== null && enc.count !== undefined ? `<b>${esc(enc.count)}</b> ` : ""}${esc(enc.name ?? "")}`;
  else if (enc.kind === "flavor") what = esc(shorten(enc.text ?? ""));
  else what = esc(t(enc.noTable ? "SDE.clock.enc.stripNoTable" : "SDE.clock.enc.stripEmpty"));
  return `<div class="sde-hud-strip">
    <span class="sde-hud-bl">${esc(t("SDE.encounter.chat.heading"))}</span>
    <span class="sde-hud-cap"${enc.kind === "flavor" ? ` data-tooltip="${esc(enc.text ?? "")}"` : ""}>${esc(dateParts(cal, enc.at).time)} · ${what}</span>
    ${battle ? `<span class="sde-hud-tag">${esc(t("SDE.encounterMaps.hud.marker"))}</span>` : ""}
    ${chevron(false)}
    ${key("resume", t("SDE.overland.resume"), { cls: "sde-hud-sm", hint: t("SDE.overland.resumeHint") })}
  </div>`;
}
