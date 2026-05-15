export const movementPanel = {
  /**
   * @param {Actor} actor
   * @param {{ mode: "crawl"|"combat", used: number, budget: number }} ctx
   * @returns {string}
   */
  render(actor, ctx) {
    const used = ctx?.used ?? 0;
    const budget = ctx?.budget ?? 0;
    const over = used > budget ? "sde-mv-over" : "";
    return `<span class="sde-cell sde-mv ${over}">Mv ${used}/${budget}</span>`;
  },
};
