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
import { filledTables } from "./rules-data-core.mjs";
import { storedRulesFor, usesOwnRuleset } from "./rules-data-scope.mjs";
import { rulesNoticeCard } from "../shared/chat-cards.mjs";

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
 * A map with a ruleset of its own is set up by hand in the Rules data window;
 * the card's advice (import from the GM Guide) is about the default ruleset,
 * so it stays quiet there.
 * @param {"terrain"|"climate"} id  a RULES_TABLES id with a notice text
 * @param {Scene|null} [scene]  the scene whose ruleset is read (default: the one being viewed)
 * @returns {Promise<boolean>} whether a card was posted
 */
export async function tellMissing(id, scene = globalThis.canvas?.scene) {
  if (!game.user?.isGM || told.has(id) || usesOwnRuleset(scene)) return false;
  if (filledTables(storedRulesFor(scene))[id]) return false;
  told.add(id);
  await ChatMessage.create({
    content: rulesNoticeCard({ text: t(`SDE.rulesData.missing.${id}`), button: t("SDE.rulesData.openStep") }),
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
