/**
 * Shadowdark Enhancer — "the Rules Data isn't set" notices (#299).
 *
 * A feature that reads an empty Rules Data table quietly falls back (every hex
 * costs 1, a storm never turns harsh). tellMissing() is called where it does,
 * and tells the GM once per session per table, in a whispered card that says
 * exactly what to press and has a button that opens the Importer Hub's Rules
 * Data step. A player is never told: it is the GM's setup, not theirs.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { filledTables } from "./rules-data-core.mjs";

const t = (key) => game.i18n.localize(key);

/** The tables already told about this session. */
const told = new Set();

/** Open the Importer Hub scrolled to its Rules Data step. */
export async function openRulesStep() {
  const { ImporterHubApp } = await import("../importer/importer-hub-app.mjs");
  return ImporterHubApp.openRulesData();
}

/**
 * Tell the GM a table is empty, once per session. Does nothing for a player,
 * for a table that has values, or for one already told about.
 * @param {"terrain"|"climate"} id  a RULES_TABLES id with a notice text
 * @returns {Promise<boolean>} whether a card was posted
 */
export async function tellMissing(id) {
  if (!game.user?.isGM || told.has(id)) return false;
  let stored = null;
  try { stored = game.settings.get(MODULE_ID, "rulesData"); } catch { /* not registered: nothing is set */ }
  if (filledTables(stored)[id]) return false;
  told.add(id);
  await ChatMessage.create({
    content: `<div class="sde-rules-notice"><p>${esc(t(`SDE.rulesData.missing.${id}`))}</p>`
      + `<button type="button"><i class="fa-solid fa-scroll"></i> ${esc(t("SDE.rulesData.openStep"))}</button></div>`,
    speaker: { alias: t("SDE.rulesData.title") },
    whisper: ChatMessage.getWhisperRecipients("GM"),
    flags: { [MODULE_ID]: { rulesNotice: id } },
  }).catch((err) => console.error(`${MODULE_ID} | rules data notice`, err));
  return true;
}

/** Wire the card's button, on every render of it (the log re-renders). */
export function registerRulesNotice() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!message.flags?.[MODULE_ID]?.rulesNotice) return;
    html.querySelector("button")?.addEventListener("click", () => openRulesStep());
  });
}
