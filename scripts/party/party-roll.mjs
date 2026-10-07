import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { registerQuery, refuseQuery, queryActiveGM } from "../shared/gm-relay.mjs";
import { ROLL_STAT_LABELS, rollRequest, rollCardHtml, rollResultText, rollVerdict, withRollResult } from "./party-sheet-core.mjs";

/**
 * Request roll: the GM posts ONE chat card with a Roll link per character asked. The owner of a character clicks
 * theirs and the system's own ability check runs (against the card's DC when it has one); the result is posted
 * with pass or fail. The card says what was asked in its message flag; nothing on it is written back, so any
 * player can use it (a message can only be updated by its author).
 */
export const PARTY_ROLL_FLAG = "partyRoll";
export const PARTY_ROLL_QUERY = `${MODULE_ID}.partyRollResult`;

const t = (key) => game.i18n.localize(key);
const sayWith = (key, data) => game.i18n.format(key, data);

/**
 * Post the card for a request: { stat, dc, targets: [{uuid, name}] } from the GM bar, or the same with a trap's
 * heading, intro and damage (see rollRequest). `speaker` is the alias the card is posted under (the Party's, by
 * default). Returns the message, or null.
 */
export async function postRollRequest(form, { speaker = t("SDE.party.roll.speaker") } = {}) {
  if (!game.user?.isGM) return null;
  const request = rollRequest(form);
  if (!request) { ui.notifications.warn(t("SDE.party.roll.noTargets")); return null; }
  const statLabel = t(ROLL_STAT_LABELS[request.stat]);
  return ChatMessage.create({
    content: rollCardHtml(request, { sayWith, statLabel, esc }),
    speaker: { alias: speaker },
    flags: { [MODULE_ID]: { [PARTY_ROLL_FLAG]: request } },
  });
}

/**
 * Record one character's roll on the card, so everyone looking at it sees who passed or failed. Only a GM (or
 * the author) may update a chat message, so a player's client asks the active GM (applyRollResult).
 */
async function recordRollResult(message, result) {
  if (game.user?.isGM) return applyRollResult({ messageId: message.id, ...result }, game.user);
  return queryActiveGM(PARTY_ROLL_QUERY, { messageId: message.id, ...result }, { label: t("SDE.party.roll.speaker") });
}

/**
 * A character takes a trap's damage: the dice are rolled in chat, where everyone sees them, and the system applies them (it
 * keeps HP between 0 and the maximum, and marks a character at 0 as defeated). A formula Foundry cannot roll warns the GM and
 * costs nobody hit points.
 */
export async function takeTrapDamage(actor, formula, source = "") {
  try {
    const roll = await new Roll(formula).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: sayWith("SDE.trap.damageFlavor", { name: actor.name, trap: source }) });
    await actor.applyDamage(roll.total);
  } catch (error) {
    console.error(`${MODULE_ID} | trap damage`, error);
    ui.notifications.warn(sayWith("SDE.trap.damageFailed", { name: actor.name, formula }));
  }
}

/** A pass on a card whose trap holds its victims frees the token that character stands for. */
async function freeFromHold(request, uuid) {
  const entry = request.targets.find((target) => target.uuid === uuid);
  const token = entry?.token ? await fromUuid(entry.token) : null;
  if (!token?.getFlag(MODULE_ID, "held")) return;
  await token.unsetFlag(MODULE_ID, "held");
  await ChatMessage.create({ content: `<p>${esc(sayWith("SDE.trap.freed", { name: entry.name, trap: request.source ?? "" }))}</p>`, speaker: { alias: request.source || t("SDE.trap.label") } });
}

/** On the GM's client: write the result into the card, once per character, for that character's owner. */
async function applyRollResult(data, user) {
  const { messageId, uuid, total = null, outcome = null } = data && typeof data === "object" ? data : {};
  if (typeof messageId !== "string" || typeof uuid !== "string") return { ok: false };
  const message = game.messages?.get(messageId);
  const request = message?.flags?.[MODULE_ID]?.[PARTY_ROLL_FLAG];
  if (!request?.targets?.some((entry) => entry.uuid === uuid)) return { ok: false };
  const actor = await fromUuid(uuid);
  if (!actor || !(user?.isGM || actor.testUserPermission?.(user, "OWNER"))) return { ok: false };
  const next = withRollResult(request, { uuid, total: typeof total === "number" ? total : null, outcome });
  if (next === request) return { ok: true };
  await replaceModuleFlag(message, PARTY_ROLL_FLAG, next, { content: rollCardHtml(next, { sayWith, statLabel: t(ROLL_STAT_LABELS[next.stat]), esc }) });
  // Only the roll that was just recorded can hurt: a result already on the card returned above.
  const recorded = next.results.find((r) => r.uuid === uuid)?.outcome;
  if (next.damage && recorded === "fail") await takeTrapDamage(actor, next.damage, next.source ?? "");
  if (next.hold && recorded === "pass") await freeFromHold(next, uuid);
  return { ok: true };
}

/** One character's roll from a card: its owner's click runs the system's ability check, then posts pass or fail. */
export async function rollFromCard(message, uuid) {
  const request = message?.flags?.[MODULE_ID]?.[PARTY_ROLL_FLAG];
  const target = request?.targets?.find((entry) => entry.uuid === uuid);
  if (!target) return null;
  const actor = await fromUuid(uuid);
  if (!actor?.isOwner) { ui.notifications.warn(t("SDE.party.roll.notOwner")); return null; }
  if (typeof actor.system?.rollStatCheck !== "function") { ui.notifications.warn(t("SDE.party.roll.noCheck")); return null; }
  if ((request.results ?? []).some((entry) => entry.uuid === uuid)) { ui.notifications.info(t("SDE.party.roll.already")); return null; }
  const roll = await actor.system.rollStatCheck(request.stat, request.dc === null ? {} : { mainRoll: { dc: request.dc } });
  if (roll) await recordRollResult(message, { uuid, total: Number.isFinite(Number(roll.total)) ? Number(roll.total) : null, outcome: rollVerdict({ total: roll.total, dc: request.dc, success: roll.success }) });
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
  registerQuery(PARTY_ROLL_QUERY, (data, { user } = {}) => refuseQuery(user, t("SDE.party.roll.speaker")) ?? applyRollResult(data, user));
  Hooks.on("renderChatMessageHTML", (message, html) => wireRollCard(message, html));
}
