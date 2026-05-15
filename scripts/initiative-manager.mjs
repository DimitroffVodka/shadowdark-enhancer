import { MODULE_ID } from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";

export const InitiativeManager = {
  /**
   * Roll OoC initiative for every Player token in the active scene whose
   * tokenId isn't already in CrawlState.oocInitiative.
   *
   * GM rolls for all unrolled PCs. Non-GM rolls only for actors they own.
   */
  async rollOocForAll() {
    const tokens = canvas.scene?.tokens?.contents ?? [];
    const candidates = tokens.filter(t => {
      const actor = t.actor;
      if (!actor || actor.type !== "Player") return false;
      if (CrawlState.oocInitiative[t.id]) return false;
      if (!game.user.isGM && !actor.testUserPermission(game.user, "OWNER")) return false;
      return true;
    });

    if (candidates.length === 0) {
      ui.notifications.info("Shadowdark Enhancer: nothing to roll.");
      return;
    }

    const results = [];
    for (const token of candidates) {
      const actor = token.actor;
      const bonus = Number(actor.system?.roll?.initiative?.bonus ?? 0);
      const advantage = Number(actor.system?.roll?.initiative?.advantage ?? 0);

      const baseFormula = "1d20";
      const advFn = globalThis.shadowdark?.dice?.applyAdvantage;
      const formula = (advantage !== 0 && typeof advFn === "function")
        ? advFn(baseFormula, advantage)
        : baseFormula;
      const full = bonus !== 0 ? `${formula} + ${bonus}` : formula;

      const roll = await new Roll(full).roll();
      results.push({ token, actor, roll, advantage });
    }

    // Persist results.
    for (const r of results) {
      await CrawlState.setOocInitiative(r.token.id, {
        roll: r.roll.total,
        advantage: r.advantage,
      });
    }

    // Whisper-to-GM chat summary.
    const lines = results
      .map(r => `<li><strong>${r.actor.name}</strong>: ${r.roll.total}</li>`)
      .join("");
    const html = `<div><h3>Out-of-Combat Initiative</h3><ul>${lines}</ul></div>`;
    const gmIds = ChatMessage.getWhisperRecipients("GM").map(u => u.id);
    await ChatMessage.create({
      content: html,
      whisper: gmIds,
    });
  },
};
