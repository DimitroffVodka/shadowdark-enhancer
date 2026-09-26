/**
 * Shadowdark Enhancer — monster attacks apply their stat-damage riders (#183)
 *
 * A monster attack card that HIT a character is read for riders such as
 * "1 STR damage" (attackRiders in stat-damage-core.mjs says where they live).
 * A plain rider applies at once. One behind a save, "DC 12 CON or 1d4 STR
 * damage", asks the character's player to roll the save and applies only on
 * a failure. The amount is rolled in chat, and the damage goes through the
 * statDamage API like any other.
 *
 * Works from the text Enhancer imports, so Shadowdark Extras is not needed.
 * Do not ALSO drop an Effects-library stat-damage entry into the same
 * attack's Extras on-hit slot: both would apply.
 *
 * WHO MAY POST THE CARD. Any user can create a chat message, and a player
 * macro can write a rollConfig naming a Ghost's Death Touch and another
 * character's token. The card's author must be a GM or own the attacker, and
 * the attack must be the attacker's own item (cardMayApply).
 *
 * THE SAVE PROMPT. The active GM handles the card, so the player is reached
 * with a user query in the GM→player direction: the server stamps the sender,
 * and the player's client refuses anyone but a GM (the same trust rule as the
 * merchant's notices, docs/API.md "Relay trust model"). The player's own
 * client rolls through the system's stat check, as a player rolling any save
 * does. No connected player, a closed dialog, a stale tab or the timeout all
 * fall back to the GM's client rolling it.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { esc } from "../shared/esc.mjs";
import {
  actorFromUuid, attackerActorOf, cardHit, isAttackCard, rollHit, targetActorOf,
} from "../shared/attack-card.mjs";
import { abilityKey, attackRiders, cardMayApply } from "./stat-damage-core.mjs";
import { StatDamage, abilityLabel } from "./stat-damage.mjs";

/** GM → owning player: "roll this save". */
export const SAVE_QUERY = `${MODULE_ID}.statDamageSave`;

/** How long the player has to roll before the GM's client rolls for them. */
const SAVE_TIMEOUT_MS = 120_000;

let _installed = false;

/** The system's stat check against a DC: the dialog for a player, none for the GM's fallback. */
function rollSave(actor, ability, dc, title, skipPrompt) {
  return actor.system.rollStatCheck(ability, { mainRoll: { dc }, skipPrompt, title });
}

/** The check's heading: the caller's own (Overland's forage), else "Save against {source}". */
const saveTitle = (source, title) => (typeof title === "string" && title
  ? title : game.i18n.format("SDE.statDamage.saveTitle", { source }));

export const StatRiders = {

  init() {
    if (_installed) return;
    CONFIG.queries[SAVE_QUERY] = (data, { user } = {}) => StatRiders.handleSaveQuery(data, user);
    Hooks.on("createChatMessage", (message) => {
      StatRiders._onAttackCard(message).catch((err) =>
        console.warn(`${MODULE_ID} | stat damage: could not apply an attack's rider`, err));
    });
    _installed = true;
  },

  /** A monster's attack card landed in chat: did it hit a character, with riders? */
  async _onAttackCard(message) {
    if (!isActiveGM() || !isAttackCard(message) || !cardHit(message)) return;
    const itemUuid = message.flags?.shadowdark?.rollConfig?.itemUuid;
    if (!itemUuid) return;
    const attacker = await attackerActorOf(message);
    const target = await targetActorOf(message);
    if (attacker?.type !== "NPC" || target?.type !== "Player") return;
    const attack = await fromUuid(itemUuid).catch(() => null);
    const author = message.author;
    if (!cardMayApply({
      authorIsGM: !!author?.isGM,
      authorOwnsAttacker: !!author && attacker.testUserPermission(author, "OWNER"),
      attackOwnerUuid: attack?.parent?.uuid,
      attackerUuid: attacker.uuid,
    })) return;

    for (const rider of attackRiders(attack, attacker.items)) {
      if (rider.save && await StatRiders.save(target, rider.save, attack.name)) continue;
      const roll = await new Roll(rider.amount).evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        flavor: esc(game.i18n.format("SDE.statDamage.rider", {
          target: target.name, ability: abilityLabel(rider.ability), source: attack.name,
        })),
      });
      await StatDamage.apply(target, rider.ability, roll.total);
    }
  },

  /**
   * Ask the character's player to make the save; roll it here when no player can.
   * Overland's forage and underground checks (#233) reuse it with their own `title`.
   * @param {{title?:string}} [options]
   * @returns {Promise<boolean>} true when the save succeeded.
   */
  async save(target, { ability, dc }, source, { title } = {}) {
    const heading = saveTitle(source, title);
    const owners = game.users.filter((u) => u.active && !u.isGM && target.testUserPermission(u, "OWNER"));
    const player = owners.find((u) => u.character?.id === target.id) ?? owners[0];
    if (player) {
      const reply = await player.query(SAVE_QUERY,
        { actorUuid: target.uuid, ability, dc, source, title: heading }, { timeout: SAVE_TIMEOUT_MS })
        .catch(() => null);
      if (reply?.ok) return !!reply.saved;
    }
    return rollHit((await rollSave(target, ability, dc, heading, true)) || {});
  },

  /** Player side: only a GM may ask, and only for a character this client owns. */
  async handleSaveQuery(data, user) {
    if (!user?.isGM) return { ok: false };
    const actor = await actorFromUuid(data?.actorUuid);
    const ability = abilityKey(data?.ability);
    const dc = Number(data?.dc);
    if (!actor?.isOwner || !ability || !(dc > 0)) return { ok: false };
    const roll = await rollSave(actor, ability, dc, saveTitle(String(data.source ?? ""), data.title), false);
    return roll ? { ok: true, saved: rollHit(roll) } : { ok: false };
  },
};
