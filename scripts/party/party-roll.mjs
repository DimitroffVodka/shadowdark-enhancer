import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { ROLL_STAT_LABELS, rollRequest, rollCardHtml, rollResultText } from "./party-sheet-core.mjs";

/**
 * Request roll: the GM posts ONE chat card with a Roll link per character asked. The owner of a character clicks
 * theirs and the system's own ability check runs (against the card's DC when it has one); the result is posted
 * with pass or fail. The card says what was asked in its message flag; nothing on it is written back, so any
 * player can use it (a message can only be updated by its author).
 */
export const PARTY_ROLL_FLAG = "partyRoll";

const t = (key) => game.i18n.localize(key);
const sayWith = (key, data) => game.i18n.format(key, data);

/** Post the card for a request from the GM bar: { stat, dc, targets: [{uuid, name}] }. Returns the message, or null. */
export async function postRollRequest(form) {
  if (!game.user?.isGM) return null;
  const request = rollRequest(form);
  if (!request) { ui.notifications.warn(t("SDE.party.roll.noTargets")); return null; }
  const statLabel = t(ROLL_STAT_LABELS[request.stat]);
  return ChatMessage.create({
    content: rollCardHtml(request, { sayWith, statLabel, esc }),
    speaker: { alias: t("SDE.party.roll.speaker") },
    flags: { [MODULE_ID]: { [PARTY_ROLL_FLAG]: request } },
  });
}

/** One character's roll from a card: its owner's click runs the system's ability check, then posts pass or fail. */
export async function rollFromCard(message, uuid) {
  const request = message?.flags?.[MODULE_ID]?.[PARTY_ROLL_FLAG];
  const target = request?.targets?.find((entry) => entry.uuid === uuid);
  if (!target) return null;
  const actor = await fromUuid(uuid);
  if (!actor?.isOwner) { ui.notifications.warn(t("SDE.party.roll.notOwner")); return null; }
  if (typeof actor.system?.rollStatCheck !== "function") { ui.notifications.warn(t("SDE.party.roll.noCheck")); return null; }
  const roll = await actor.system.rollStatCheck(request.stat, request.dc === null ? {} : { mainRoll: { dc: request.dc } });
  const text = rollResultText({ name: actor.name, total: roll?.total, dc: request.dc, success: roll?.success }, { sayWith });
  if (text) await ChatMessage.create({ content: `<p class="sde-party-roll-result">${esc(text)}</p>`, speaker: ChatMessage.getSpeaker({ actor }) });
  return roll ?? null;
}

/** Wire the Roll links of a rendered chat card. A link that is mid-roll ignores a second click. */
export function wireRollCard(message, html) {
  if (!message?.flags?.[MODULE_ID]?.[PARTY_ROLL_FLAG]) return;
  for (const link of html.querySelectorAll("a[data-party-roll]")) {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      if (link.classList.contains("busy")) return;
      link.classList.add("busy");
      try { await rollFromCard(message, link.dataset.uuid); }
      catch (error) { console.error(`${MODULE_ID} | Party roll`, error); }
      finally { link.classList.remove("busy"); }
    });
  }
}

export function registerPartyRoll() {
  Hooks.on("renderChatMessageHTML", (message, html) => wireRollCard(message, html));
}
