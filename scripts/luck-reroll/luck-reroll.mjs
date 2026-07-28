/**
 * Shadowdark Enhancer — Luck Reroll hooks
 *
 * Wraps the Shadowdark system's built-in chat-card reroll (`_onReroll`)
 * to add nat-1 prevention and session-recap tracking.
 *
 * The system already handles Luck spending and dice re-rolling — we just
 * gate it and log the results.
 *
 * Two system shapes this has to work around:
 *   - `_onReroll` is defined on `CONFIG.ChatMessage.documentClass`
 *     (ChatMessageSD); the global `ChatMessage` has no such method, so
 *     patching that prototype installs nothing.
 *   - it is synchronous and drops the promise `rerollFromMessage` returns, and
 *     a MAIN reroll posts a NEW message rather than mutating this one
 *     (shadowdark/src/dice/dice.mjs). Awaiting the call therefore cannot see
 *     the outcome — we snapshot the "before" totals and let the chat hooks
 *     report the result: createChatMessage for main, updateChatMessage for
 *     damage.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";

/** Relay action for recap writes made by a client that can't write settings. */
const SOCKET_ACTION = "luck:logSpent";

/** Pre-reroll snapshots keyed `${actorUuid}:${rollType}`, consumed by settle(). */
const _pending = new Map();

/** A snapshot whose reroll never landed (cancelled dialog, error) must not log later. */
const PENDING_TTL_MS = 60000;

let _originalOnReroll = null;
let _installed = false;

/**
 * Check whether a roll resulted in a natural 1 on a d20.
 */
function isNatural1(roll) {
  if (!roll?.dice?.length) return false;
  return roll.dice.some(die =>
    die.faces === 20 &&
    die.results.some(r => r.active !== false && r.result === 1)
  );
}

/** A message's main or damage roll, preferring the system's own accessor. */
function rollOf(message, rollType) {
  return message.getRoll?.(rollType) ?? message.rolls?.[rollType === "damage" ? 1 : 0];
}

/** True only on the single GM that owns recap writes. */
function isPrimaryGM() {
  return !!game.user?.isGM && game.users.activeGM?.id === game.user.id;
}

/**
 * Write one Luck-spent entry. The recap lives in a world setting, which players
 * (and second GMs) can't write — they hand it to the primary GM over the module
 * socket, mirroring the crawl strip's `luck:give` relay.
 */
async function recordLuckSpent(entry) {
  if (isPrimaryGM()) {
    await SessionRecap.logLuckSpent(entry);
    return;
  }
  game.socket.emit(`module.${MODULE_ID}`, { action: SOCKET_ACTION, entry });
}

/**
 * Report a landed reroll against its snapshot.
 *
 * Main rerolls arrive as a brand-new message; damage rerolls arrive as updates
 * to the original — and the damage path updates twice (once to strip the old
 * damage roll, once to append the replacement), so the snapshot is only
 * consumed when the new roll is actually present.
 */
async function settle(message, rollType) {
  if (!_pending.size) return;

  const config = message.flags?.shadowdark?.rollConfig;
  if (!config?.actorUuid) return;

  const flagged = rollType === "damage"
    ? config.damageRoll?.reroll === true
    : config.mainRoll?.reroll === true;
  if (!flagged) return;

  const key = `${config.actorUuid}:${rollType}`;
  const before = _pending.get(key);
  if (!before) return;

  if (Date.now() - before.at > PENDING_TTL_MS) {
    _pending.delete(key);
    return;
  }

  const newRoll = rollOf(message, rollType);
  if (!newRoll) return; // damage: first update strips the roll — wait for the second
  _pending.delete(key);

  await recordLuckSpent({
    player: before.player,
    actorId: before.actorId,
    formula: before.formula,
    oldTotal: before.oldTotal,
    newTotal: newRoll.total,
  });
}

export function init() {
  if (_installed) return;

  const proto = CONFIG.ChatMessage?.documentClass?.prototype;
  if (!proto?._onReroll) return; // system not loaded, or the method was renamed

  _originalOnReroll = proto._onReroll;

  proto._onReroll = function (event, btn) {
    const rollType = btn?.dataset?.rollType === "damage" ? "damage" : "main";

    if (game.settings.get(MODULE_ID, "luckRerollPreventNat1") === true) {
      const roll = rollOf(this, rollType);
      if (roll && isNatural1(roll)) {
        ui.notifications?.warn(game.i18n.localize("SDE.luckReroll.nat1Blocked"));
        return; // returning before the system runs means no Luck is spent
      }
    }

    // Snapshot before delegating: the system's handler returns before its dice
    // land, and a main reroll lands on a different message, so there is nothing
    // to read once it returns. settle() picks this up from the chat hooks.
    if (SessionRecap.isActive()) {
      const actorId = this.speaker?.actor;
      const actor = actorId ? game.actors.get(actorId) : null;
      const oldRoll = rollOf(this, rollType);
      const actorUuid = this.flags?.shadowdark?.rollConfig?.actorUuid ?? actor?.uuid;
      if (actor && oldRoll && actorUuid) {
        _pending.set(`${actorUuid}:${rollType}`, {
          player: actor.name,
          actorId: actor.id,
          formula: oldRoll.formula,
          oldTotal: oldRoll.total,
          at: Date.now(),
        });
      }
    }

    return _originalOnReroll.call(this, event, btn);
  };

  Hooks.on("createChatMessage", (message) => settle(message, "main"));
  Hooks.on("updateChatMessage", (message) => settle(message, "damage"));

  game.socket.on(`module.${MODULE_ID}`, async (msg) => {
    if (msg?.action !== SOCKET_ACTION || !msg.entry) return;
    if (!isPrimaryGM()) return;
    await SessionRecap.logLuckSpent(msg.entry);
  });

  _installed = true;
}
