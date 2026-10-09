/**
 * Shadowdark Enhancer — hover preview of a creature.
 *
 * A rolled creature (the roller's rows and result card, the clock HUD's
 * Encounter panel) shows a small stat card on hover, so the GM can read the
 * werewolf before telling the table anything; a double click opens the sheet.
 * The card is Foundry's own tooltip (game.tooltip.activate with an html body),
 * which brings the hover delay, the placement and the dismissal with it.
 */

import { esc } from "../shared/esc.mjs";
import { createNpcIndexRow } from "./npc-index.mjs";

const t = (key, data) => (data ? globalThis.game?.i18n?.format(key, data) : globalThis.game?.i18n?.localize(key)) ?? key;
const items = (actor, type) => [...(actor?.items ?? [])].filter((i) => i?.type === type);
/** Item text with its markup, @UUID links and inline rolls reduced to words, cut at `n` characters. */
const plain = (html, n = 170) => {
  const s = String(html ?? "").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\[\[\/r\s+([^\]]+)\]\]/g, "$1")
    .replace(/<\/(?:p|div|li|h\d)>|<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, "")}…`;
};

/**
 * The card's facts for an NPC actor.
 * @param {Actor} actor
 */
export function npcPreviewModel(actor) {
  const row = createNpcIndexRow(actor);
  const attacks = items(actor, "NPC Attack").map((a) => {
    const num = Math.max(1, Number(a.system?.attack?.num) || 1);
    const bonus = Number(a.system?.bonuses?.attackBonus) || 0;
    const damage = String(a.system?.damage?.value ?? "").trim();
    const extra = plain(a.system?.damage?.special ?? "", 90);
    return { name: a.name, text: `${num > 1 ? `${num}× ` : ""}${bonus >= 0 ? "+" : ""}${bonus}${damage ? ` · ${damage}` : ""}`, extra };
  });
  const special = items(actor, "NPC Special Attack").map((a) => ({ name: a.name, text: "", extra: plain(a.system?.description, 120) }));
  const features = items(actor, "NPC Feature").map((f) => ({ name: f.name, text: plain(f.system?.description) }));
  return {
    name: row.name, img: row.img, level: row.levelLabel, alignment: row.alignmentLabel, ac: row.acLabel, hp: row.hpLabel,
    move: row.moveLabel, attacks: [...attacks, ...special], features,
    spell: row.hasSpellcasting ? row.spellcastingBonus : null, dark: row.darkAdapted,
  };
}

/** The card, as the markup the tooltip takes. */
export function npcPreviewHtml(m) {
  const stat = (label, v) => `<span><b>${esc(label)}</b> ${esc(v)}</span>`;
  const line = (r) => `<li><b>${esc(r.name)}</b>${r.text ? ` ${esc(r.text)}` : ""}${r.extra ? ` <em>${esc(r.extra)}</em>` : ""}</li>`;
  const list = (heading, rows) => (rows.length ? `<h4>${esc(t(heading))}</h4><ul>${rows.map(line).join("")}</ul>` : "");
  const spell = m.spell === null ? [] : [{ name: t("SDE.encounter.preview.spellcaster"), text: `${m.spell >= 0 ? "+" : ""}${m.spell}` }];
  return `<div class="sde-npc-preview">
    <header><img src="${esc(m.img)}" alt=""><div><strong>${esc(m.name)}</strong>
      <span class="sde-np-sub">${esc(t("SDE.encounter.browse.col.level"))} ${esc(m.level)}${m.alignment ? ` · ${esc(m.alignment)}` : ""}</span></div></header>
    <p class="sde-np-stats">${stat(t("SDE.encounter.browse.col.ac"), m.ac)}${stat(t("SDE.encounter.browse.col.hp"), m.hp)}${
      stat(t("SDE.encounter.preview.move"), m.move)}</p>
    ${list("SDE.encounter.preview.attacks", m.attacks)}
    ${list("SDE.encounter.preview.features", [...m.features, ...spell])}
    <p class="sde-np-hint">${esc(t("SDE.encounter.openSheetTip"))}</p>
  </div>`;
}

/**
 * Show the card on `el` for the creature at `uuid`, unless the pointer has left while it resolved.
 * @param {HTMLElement} el
 * @param {string} uuid
 */
export async function showNpcPreview(el, uuid) {
  const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
  if (!actor || !el.isConnected || !el.matches(":hover")) return;
  game.tooltip.activate(el, { html: npcPreviewHtml(npcPreviewModel(actor)), cssClass: "sde-npc-tip" });
}

/** Take the card down if it is `el`'s. */
export function hideNpcPreview(el) {
  if (game.tooltip.element === el) game.tooltip.deactivate();
}

/**
 * Hover and double click on every `selector` match under `root`: the card, and the sheet.
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {(el:HTMLElement)=>string|undefined} uuidOf
 */
export function bindNpcPreview(root, selector, uuidOf) {
  for (const el of root.querySelectorAll(selector)) {
    el.addEventListener("pointerenter", () => showNpcPreview(el, uuidOf(el)));
    el.addEventListener("pointerleave", () => hideNpcPreview(el));
  }
}
