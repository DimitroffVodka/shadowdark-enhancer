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
