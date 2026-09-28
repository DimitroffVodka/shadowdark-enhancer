/**
 * Shadowdark Enhancer — the clock HUD's Encounter panel (#257, the demo's).
 *
 * A travel check that hits rolls quietly (encounter.check's `quiet`): nothing
 * reaches chat, and what it drew is held in Overland's `encounter` for the GMs.
 * This panel shows it: the check, the chain of tables it went through, the
 * creature and how many, and the distance, activity and reaction rolls. Post
 * to chat shows the players; Continue runs the rest of the clock. The buttons
 * are the clock HUD's (overland-bar.mjs handles their data-action).
 */

import { esc } from "../shared/esc.mjs";
import { dateParts } from "../time/time-core.mjs";
import { facetWords } from "../encounter/encounter-result.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const gold = (v) => `<span class="sde-hud-gold">${esc(v)}</span>`;
const key = (action, label, { cls = "", hint = "" } = {}) =>
  `<button type="button" class="sde-hud-key ${cls}" data-action="${action}"${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</button>`;

/** A table in the chain, as a chip: its name, its dice and their roll (no-break spaces: a flex chip drops plain ones). */
const tableChip = (l) => `<span class="sde-hud-chip">${esc(l.name ?? "")}${
  l.roll !== null && l.roll !== undefined ? `\u00a0· ${esc(l.formula ?? "")}\u00a0${gold(l.roll)}` : ""}</span>`;

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
 * @param {{enc:object, cal:object}} v  enc: Overland's `encounter`; cal: the calendar
 */
export function encounterPanel({ enc, cal }) {
  const c = encounterCard(enc);
  const check = t(enc.half === "night" ? "SDE.overland.check.night" : "SDE.overland.check.day", { time: dateParts(cal, enc.at).time });
  const header = t("SDE.clock.enc.header", { step: enc.half === "night" ? 8 : 6, check, chance: enc.chance });
  const chain = enc.chain.map((l) => (l.category ? `<span class="sde-hud-cat">${esc(l.category)}</span>` : tableChip(l)))
    .join('<i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i>');
  let body;
  if (c.kind === "monster") {
    const facet = (label, die, roll, word, cls = "") => `<div class="sde-hud-facet"><span class="sde-hud-cap">${
      esc(t(label))} · ${esc(die)} ${gold(roll)}</span><span class="sde-hud-v ${cls}">${esc(word)}</span></div>`;
    body = `<div class="sde-hud-what"><img src="${esc(c.img ?? "")}" alt="">${gold(c.count ?? 1)}<span class="sde-hud-bl">${esc(c.name ?? "")}</span></div>`
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
    <div class="sde-hud-ph"><span class="sde-hud-cap">${esc(header)}</span></div>
    <div class="sde-hud-pb">
      <span class="sde-hud-bl sde-hud-big">${esc(t("SDE.encounter.chat.heading"))}</span>
      ${chain ? `<div class="sde-hud-chain">${chain}</div>` : ""}
      ${body}
      ${c.via ? `<span class="sde-hud-fl">${esc(c.via)}</span>` : ""}
      ${also}
      <span class="sde-hud-fl">${esc(t("SDE.clock.enc.secret"))}</span>
    </div>
    <div class="sde-hud-pf">
      ${c.kind === "empty" ? "" : key("postEncounter", t("SDE.clock.enc.post"), { hint: t("SDE.clock.enc.postHint") })}
      ${key("openRoller", t("SDE.clock.enc.roller"), { cls: "sde-hud-ghost", hint: t("SDE.clock.enc.rollerHint") })}
      <span class="sde-hud-grow"></span>
      ${key("resume", t("SDE.overland.resume"), { cls: "sde-hud-primary", hint: t("SDE.overland.resumeHint") })}
    </div>
  </div>`;
}
