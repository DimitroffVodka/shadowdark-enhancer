export const luckPanel = {
  /**
   * @param {Actor} actor
   * @returns {string}
   */
  render(actor) {
    // NPCs in base Shadowdark have no luck schema. PC schema exposes
    // system.luck.{available, remaining} and system.hasLuckToken getter.
    if (!actor?.system || !Object.prototype.hasOwnProperty.call(actor.system, "luck")) {
      return `<span class="sde-cell sde-luck sde-luck-na">Luck —</span>`;
    }

    const luck = actor.system.luck ?? { available: false, remaining: 0 };
    const hasToken = actor.system.hasLuckToken === true;

    let pipsHtml;
    if ((luck.remaining ?? 0) > 0) {
      pipsHtml = Array(luck.remaining).fill(0).map(() =>
        `<span class="sde-pip sde-pip-filled" data-action="spendLuck" data-actor-id="${actor.id}" title="Spend luck (${luck.remaining} left)"></span>`
      ).join("");
    } else if (luck.available) {
      pipsHtml = `<span class="sde-pip sde-pip-filled" data-action="spendLuck" data-actor-id="${actor.id}" title="Spend luck"></span>`;
    } else {
      pipsHtml = `<span class="sde-pip sde-pip-empty" title="No luck token"></span>`;
    }

    const interactive = hasToken ? "sde-luck-interactive" : "";
    return `<span class="sde-cell sde-luck ${interactive}">Luck ${pipsHtml}</span>`;
  },
};
