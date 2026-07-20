/**
 * Bidirectional token.hidden ↔ combatant.hidden sync.
 *
 * Forked from vagabond-crawler/scripts/crawl-strip.mjs (the `updateToken` /
 * `updateCombatant` sync handlers).
 *
 * GM-only. Each handler guards against unnecessary writes by checking that
 * the target side's value differs from the new value — this prevents an
 * infinite hook loop (token→combatant→token→…).
 */

export function registerHiddenSync() {
  // Adding a hidden token to combat creates a combatant with hidden=false
  // (Foundry does NOT copy token.hidden). Stamp it at creation so the hidden
  // combatant is suppressed from players via the fully-synced combatant.hidden
  // flag — not just the token's. Respects an explicit hidden already in the
  // create data. Runs on the creating client (the GM adding to combat).
  Hooks.on("preCreateCombatant", (combatant, data) => {
    if (data.hidden !== undefined) return;
    const scene = data.sceneId ? game.scenes.get(data.sceneId) : combatant.parent?.scene;
    const tokenDoc = scene?.tokens?.get(data.tokenId);
    if (tokenDoc?.hidden) combatant.updateSource({ hidden: true });
  });

  // Suppress the initiative-roll chat card for a HIDDEN combatant. Foundry
  // rolls hidden combatants' initiative as a private (gm) roll, but a *roll*
  // message with a whisper is still shown to players as a "GM privately rolled
  // some dice / ???" placeholder — which tips them off that a hidden combatant
  // just entered initiative. Core writes the combatant's initiative BEFORE
  // creating the card (Combat#rollInitiative), so canceling the card here keeps
  // the initiative and simply posts nothing — no leak from any roll path (the
  // strip's roll button, the tracker's Roll NPCs / Roll All). Fires on the
  // rolling client (the GM); per-message, so mixed hidden/visible rolls only
  // drop the hidden ones. Non-initiative rolls and OoC crawl init (no
  // core.initiativeRoll flag) are untouched.
  Hooks.on("preCreateChatMessage", (message, data) => {
    if (!data?.flags?.core?.initiativeRoll) return;
    const speaker = data.speaker ?? message.speaker ?? {};
    const scene = speaker.scene ? game.scenes.get(speaker.scene) : (game.combat?.scene ?? canvas.scene);
    const tokenDoc = speaker.token ? scene?.tokens?.get(speaker.token) : null;
    const combatant = speaker.token
      ? game.combat?.combatants.find(c => c.tokenId === speaker.token)
      : null;
    const hidden = tokenDoc?.hidden === true || combatant?.hidden === true;
    if (hidden) return false; // cancel creation — initiative is already set
  });

  Hooks.on("updateToken", async (tokenDoc, changes) => {
    if (!("hidden" in changes)) return;
    if (!game.user.isGM) return;
    if (!game.combat) return;
    const combatant = game.combat.combatants.find(c => c.tokenId === tokenDoc.id);
    if (!combatant) return;
    if (combatant.hidden === changes.hidden) return;
    await combatant.update({ hidden: changes.hidden });
  });

  Hooks.on("updateCombatant", async (combatant, changes) => {
    if (!("hidden" in changes)) return;
    if (!game.user.isGM) return;
    const tokenDoc = combatant.token;
    if (!tokenDoc) return;
    if (tokenDoc.hidden === changes.hidden) return;
    await tokenDoc.update({ hidden: changes.hidden });
  });
}
