/**
 * Shadowdark Enhancer — find the party on the map, from the clock HUD.
 *
 * Pans to the party's token, pulses on it and, when this viewer can, selects it. The pulse is drawn on this client only
 * (canvas.ping would show every player where the GM is looking). A token on another scene is named, not jumped to.
 */
import { Party, isParty } from "../party/party.mjs";
import { pickPartyToken } from "./hud-core.mjs";
import { L as t } from "../shared/i18n.mjs";

const partyDocs = (scene) => (scene?.tokens?.contents ?? []).filter((d) => isParty(d.actor));

/** @returns {Promise<boolean>} whether a token was found and shown */
export async function findParty() {
  const here = partyDocs(canvas.scene).map((d) => ({ id: d.id, actorUuid: d.actor.uuid }));
  const token = canvas.tokens.get(pickPartyToken(here, Party.selected()?.uuid)?.id);
  if (!token?.visible) {
    const elsewhere = game.user.isGM ? game.scenes.find((s) => s !== canvas.scene && partyDocs(s).length) : null;
    ui.notifications.warn(elsewhere ? t("SDE.clock.find.elsewhere", { scene: elsewhere.name }) : t("SDE.clock.find.none"));
    return false;
  }
  const { x, y } = token.center;
  await canvas.animatePan({ x, y, duration: 400 });
  canvas.controls.drawPing({ x, y }, { style: "pulse", user: game.user });
  // Selecting needs the Tokens layer; a GM working on another layer is not switched off it.
  if (canvas.tokens.active && token.document.isOwner) token.control({ releaseOthers: true });
  return true;
}

/** Open the party sheet: the selected party's, or the picker when there are several. */
export async function openPartySheet() {
  const { PartyApp } = await import("../party/party-app.mjs");
  return PartyApp.open();
}
