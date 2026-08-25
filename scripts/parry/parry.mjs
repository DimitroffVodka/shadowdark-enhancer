/**
 * Shadowdark Enhancer — Parry (Foundry-bound)
 *
 * "Once per day, an attack of your choice that would hit you misses instead."
 *
 * Puts a Parry button on an attack card that HIT a character holding the
 * ability, spends the use, and makes the attack miss — including undoing damage
 * the GM already applied.
 *
 * THREE THINGS THIS HAS TO GET RIGHT
 *
 * 1. It is a reaction, so it lives on the resolved card. The system already
 *    tells us everything needed: `setRollTarget` stamps `targetUuid` on the roll
 *    config and feeds the target's AC in as the DC, so `RollSD.success` IS
 *    "did it hit me" (dice.mjs:391, RollSD.mjs:29). No dice re-reading.
 *
 * 2. Damage may already be applied. `ActorSD.applyDamage` clamps at 0, so the
 *    overkill is gone and the printed damage is NOT what to give back — see
 *    damageOutcome/reversalPlan in parry-core.mjs. We snapshot HP the moment the
 *    GM applies, settle it from `updateActor` (the update inside applyDamage is
 *    not awaited, so reading straight back is a race), and reverse the recorded
 *    delta.
 *
 * 3. The card belongs to the GM, so a player cannot flag it. This is a player
 *    ACTION whose whole visible outcome happens on the GM — the criterion the
 *    luck-reroll header lays out for using the handshake-guarded relay rather
 *    than the fire-and-forget socket. So: gm-relay, authenticated sender, and
 *    the GM re-decides with canParry instead of trusting the click.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { relayToGM, authorizeActorFor, refuseQuery } from "../shared/gm-relay.mjs";
import { esc } from "../shared/esc.mjs";
import { canParry, reversalPlan, defeatStatusesFor } from "./parry-core.mjs";
import { cardHit, targetActorOf, attackerActorOf } from "../shared/attack-card.mjs";

/** The one authenticated player→GM channel for parries. */
export const PARRY_QUERY = `${MODULE_ID}.parry`;

const RELAY_LABEL = "parries";

/** Ability name to fall back on when nothing carries the flag (pre-flag worlds). */
const PARRY_NAME = "parry";

/**
 * HP snapshots taken as the GM clicks apply-damage, keyed by actor uuid and
 * settled by the `updateActor` hook. Mirrors luck-reroll's `_pending`: the
 * system's handler doesn't await the actor update, so the "after" value can only
 * be read once it lands.
 */
const _pending = new Map();

/** A snapshot whose update never arrived (cancelled re-apply dialog) must not settle later. */
const PENDING_TTL_MS = 30000;

let _installed = false;
let _originalOnApplyDamage = null;

/** Is the automation switched on for this world? */
function _enabled() {
  try { return game.settings.get(MODULE_ID, "parryAutomate") !== false; } catch { return true; }
}

/**
 * The Parry ability on an actor — by module flag first, by name second.
 *
 * Flag-first mirrors the Delver's Scavenger: a world that imported its Duelist
 * before the flag existed keeps working on the name, and a GM who renames the
 * ability keeps working on the flag.
 */
export function findParryAbility(actor) {
  const items = actor?.items ?? [];
  return items.find((i) => i.type === "Class Ability" && i.flags?.[MODULE_ID]?.parry)
    ?? items.find((i) => i.type === "Class Ability" && i.name?.toLowerCase() === PARRY_NAME)
    ?? null;
}

/** The statuses currently on an actor, as plain ids. */
function _statusesOn(actor) {
  return [...(actor?.statuses ?? [])];
}

/** Every combatant across every combat that IS this actor. */
function _combatantsFor(actor) {
  const out = [];
  for (const combat of game.combats ?? []) {
    for (const c of combat.combatants) {
      const match = actor.isToken ? c.tokenId === actor.token?.id : c.actorId === actor.id;
      if (match) out.push(c);
    }
  }
  return out;
}

export const Parry = {

  /** Register the relay query, the card wiring and the damage-snapshot wrap. */
  init() {
    if (_installed) return;
    CONFIG.queries[PARRY_QUERY] = (data, { user } = {}) => Parry.handleQuery(data, user);
    Hooks.on("renderChatMessageHTML", (message, html) => Parry._wireCard(message, html));

    // Snapshot HP as damage is applied. The apply buttons are GM-only
    // (ChatMessageSD._applyVisibilityRules strips them for players), so this
    // wrap only ever runs on a GM client.
    const proto = CONFIG.ChatMessage?.documentClass?.prototype;
    if (proto?._onApplyDamage) {
      _originalOnApplyDamage = proto._onApplyDamage;
      proto._onApplyDamage = async function (event, btn) {
        await Parry._snapshotBeforeDamage(this, btn);
        return _originalOnApplyDamage.call(this, event, btn);
      };
    }
    Hooks.on("updateActor", (actor, changed) => Parry._settleDamage(actor, changed));

    _installed = true;
  },

  // ── Damage snapshot ───────────────────────────────────────────────────────

  /**
   * Record what the target looks like BEFORE the system applies damage.
   *
   * Resolving the actor repeats the system's own branch (target vs selected
   * token) because the button decides which one gets hit, and a reversal aimed
   * at the wrong actor would be worse than none.
   */
  async _snapshotBeforeDamage(message, btn) {
    if (!_enabled()) return;
    try {
      const config = message.flags?.shadowdark?.rollConfig;
      if (!config) return;
      let actor = null;
      if (btn?.dataset?.target === "target" && config.targetUuid) {
        // Resolve through the SAME helper the button and the GM handler use.
        // Hand-rolling `(await fromUuid(uuid)).actor` here instead cost a live
        // test: `setRollTarget` normally stores a TokenDocument uuid, but an
        // Actor uuid resolves to an Actor whose `.actor` is undefined — so the
        // snapshot silently didn't happen, and the parry then spent the use and
        // gave nothing back. Two resolvers, two answers, one soundless failure.
        actor = await targetActorOf(message);
      } else if (btn?.dataset?.target === "selected") {
        actor = canvas.tokens?.controlled?.[0]?.actor ?? null;
      }
      if (!actor) return;
      _pending.set(actor.uuid, {
        messageId: message.id,
        before: actor.system?.attributes?.hp?.value ?? 0,
        hadStatuses: _statusesOn(actor),
        wasDefeated: _combatantsFor(actor).some((c) => c.defeated),
        at: Date.now(),
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | parry: damage snapshot failed`, err);
    }
  },

  /**
   * Settle a snapshot once the HP change actually lands, and park the result on
   * the message so ANY client (and a later session) can reverse it.
   */
  async _settleDamage(actor, changed) {
    if (!_pending.size) return;
    if (changed?.system?.attributes?.hp?.value === undefined) return;
    const snap = _pending.get(actor.uuid);
    if (!snap) return;
    _pending.delete(actor.uuid);
    if (Date.now() - snap.at > PENDING_TTL_MS) return;

    const after = actor.system?.attributes?.hp?.value ?? 0;
    if (after === snap.before) return;   // cancelled re-apply, or a no-op
    const message = game.messages.get(snap.messageId);
    if (!message) return;
    try {
      await message.setFlag(MODULE_ID, "parryDamage", {
        actorUuid: actor.uuid, before: snap.before, after,
        hadStatuses: snap.hadStatuses, wasDefeated: snap.wasDefeated,
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | parry: could not record the applied damage`, err);
    }
  },

  // ── Card ──────────────────────────────────────────────────────────────────

  /** Decide what this viewer may do with this card, and decorate accordingly. */
  async _wireCard(message, html) {
    if (!_enabled()) return;
    const parried = message.flags?.[MODULE_ID]?.parry;
    if (parried) return this._decorateParried(html, parried);

    const config = message.flags?.shadowdark?.rollConfig;
    if (!config?.targetUuid) return;

    const actor = await targetActorOf(message);
    if (!actor) return;
    const ability = findParryAbility(actor);
    const verdict = canParry({
      isHit: cardHit(message),
      hasTarget: true,
      parriedBy: null,
      mayAct: !!game.user?.isGM || actor.isOwner,
      hasAbility: !!ability,
      lost: !!ability?.system?.lost,
      usesAvailable: ability?.system?.uses?.available ?? 0,
    });
    if (!verdict.ok) return;

    const bar = document.createElement("div");
    bar.className = "sde-parry-bar";
    bar.innerHTML = `<button type="button" class="sde-parry-btn" data-actor-id="${esc(actor.id)}">`
      + `<i class="fa-solid fa-shield-halved"></i> `
      + `${esc(game.i18n.format("SDE.parry.button", { name: actor.name }))}</button>`;
    (html.querySelector(".message-content") ?? html).append(bar);

    bar.querySelector(".sde-parry-btn").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      const request = { action: "parry", messageId: message.id, actorId: actor.id };
      // A refused parry must hand the button back — otherwise the one use the
      // player still has looks spent.
      if (game.user.isGM) {
        const reply = await Parry._handleParry(request);
        if (!reply?.ok) { btn.disabled = false; if (reply?.error) ui.notifications?.warn(reply.error); }
      } else if (!await relayToGM(PARRY_QUERY, request, { label: RELAY_LABEL })) {
        btn.disabled = false;
      }
    });
  },

  /** A parried card reads as a miss: strike the damage, say who turned it. */
  _decorateParried(html, parried) {
    const root = html.querySelector(".message-content") ?? html;
    root.classList.add("sde-parried");
    const note = document.createElement("div");
    note.className = "sde-parry-note";
    const undone = parried.unknown
      ? game.i18n.localize("SDE.parry.checkHp")
      : (parried.reversed > 0 ? game.i18n.format("SDE.parry.reversed", { hp: parried.reversed }) : "");
    note.innerHTML = `<i class="fa-solid fa-shield-halved"></i> `
      + `${esc(game.i18n.format("SDE.parry.parriedBy", { name: parried.actorName ?? "" }))}`
      + (undone ? ` <span class="sde-parry-undone">${esc(undone)}</span>` : "");
    root.append(note);
  },

  // ── GM side ───────────────────────────────────────────────────────────────

  /** Query entry point — the only way a player reaches the handler. */
  async handleQuery(data, user) {
    const refusal = refuseQuery(user, "Parries");
    if (refusal) return refusal;
    if (data?.action === "parry") return this._handleParry(data, user);
    return { ok: false, error: "Unknown parry action." };
  },

  /**
   * Spend the use, undo the hit. Re-decides everything from documents — the
   * request carries ids and nothing else.
   */
  async _handleParry({ messageId, actorId }, user = game.user) {
    const message = game.messages.get(messageId);
    if (!message) return { ok: false, error: "That attack card is gone." };
    if (message.flags?.[MODULE_ID]?.parry) return { ok: false, error: "That attack was already parried." };

    const auth = authorizeActorFor(actorId, user);
    if (!auth.ok) return auth;
    const actor = auth.actor;

    // The parrier must actually be who the attack targeted — a player cannot
    // spend their own Parry to wave away a blow aimed at somebody else.
    const target = await targetActorOf(message);
    if (!target || target.id !== actor.id) {
      return { ok: false, error: "That attack wasn't aimed at your character." };
    }

    const ability = findParryAbility(actor);
    const verdict = canParry({
      isHit: cardHit(message),
      hasTarget: true,
      parriedBy: null,
      mayAct: true,
      hasAbility: !!ability,
      lost: !!ability?.system?.lost,
      usesAvailable: ability?.system?.uses?.available ?? 0,
    });
    if (!verdict.ok) {
      const errors = {
        "no-ability": "That character has no Parry ability.",
        "missed": "That attack missed anyway.",
        "no-uses": "No Parry uses left today.",
        "lost": "That ability is spent until you rest.",
      };
      return { ok: false, error: errors[verdict.reason] ?? "That attack can't be parried." };
    }

    // Spend first: if the reversal below throws, a used Parry is the safe
    // failure — better than a free one the player can click again.
    await ability.update({
      "system.uses.available": Math.max(0, (ability.system.uses?.available ?? 0) - 1),
    });

    const { heal: reversed, unknown } = await this._reverseDamage(message, actor);
    if (unknown) {
      ui.notifications?.warn(game.i18n.format("SDE.parry.unknownDamage", { name: actor.name }));
    }

    await message.setFlag(MODULE_ID, "parry", {
      actorId: actor.id, actorName: actor.name, reversed, unknown, at: Date.now(),
    });
    // The card no longer represents applied damage — let the system's own
    // re-apply guard reflect that, so a GM clicking apply later isn't warned
    // about a hit that never landed.
    if (message.getFlag("shadowdark", "damageApplied")) {
      await message.unsetFlag("shadowdark", "damageApplied");
    }

    // A parried attack "misses instead" — announce it so anything keyed on a
    // miss (the Duelist's own Taunt) can react, without this file knowing who
    // is listening.
    const attacker = await attackerActorOf(message);
    Hooks.callAll(`${MODULE_ID}.parried`, {
      actorId: actor.id, attackerId: attacker?.id ?? null, messageId: message.id, reversed,
    });

    await ChatMessage.create({
      speaker: { alias: actor.name },
      content: `<div class="sde-parry-card"><i class="fa-solid fa-shield-halved"></i> `
        + `${esc(game.i18n.format("SDE.parry.announce", { name: actor.name }))}`
        + (reversed > 0
          ? ` <em>${esc(game.i18n.format("SDE.parry.reversed", { hp: reversed }))}</em>` : "")
        + `</div>`,
    });
    return { ok: true, reversed };
  },

  /**
   * Give back exactly what the hit took — no more.
   *
   * `applyDamage(-heal)` rather than a raw HP write, so the system's own clamp
   * to max still applies if the character was healed in between; a negative
   * amount also can't re-trigger `_setDefeated`. Clearing the downed state is
   * ours to do, and only for the statuses this hit actually added.
   *
   * @returns {Promise<{heal: number, unknown: boolean}>} `unknown` when damage
   *   WAS applied but nothing usable was recorded — the parry still stands, and
   *   the GM is told to check the HP rather than left assuming it was handled.
   */
  async _reverseDamage(message, actor) {
    const applied = !!message.getFlag("shadowdark", "damageApplied");
    const snap = message.flags?.[MODULE_ID]?.parryDamage;
    if (!applied) return { heal: 0, unknown: false };
    if (!snap || snap.actorUuid !== actor.uuid) return { heal: 0, unknown: true };

    const combatants = _combatantsFor(actor);
    const plan = reversalPlan(snap, {
      statuses: _statusesOn(actor).filter((s) => defeatStatusesFor(actor.type).includes(s)),
      defeated: combatants.some((c) => c.defeated),
    });

    if (plan.heal > 0) await actor.applyDamage(-plan.heal);
    for (const status of plan.clearStatuses) {
      await actor.toggleStatusEffect(status, { active: false });
    }
    if (plan.clearDefeated) {
      for (const c of combatants) await c.update({ defeated: false });
    }
    await message.unsetFlag(MODULE_ID, "parryDamage");
    return { heal: plan.heal, unknown: false };
  },
};
