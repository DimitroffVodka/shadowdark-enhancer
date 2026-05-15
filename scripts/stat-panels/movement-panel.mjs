const WALK_SVG = `<svg class="sde-mv-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M9.5 1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6.5 4.5l-3 4 1.5 1.5L7 7.5v2L4 13l1.5 1L9 9.5l1 1.5V14h1.5v-4l-2-2 1.5-1 .5 1 2-1L11 5z"/></svg>`;

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
    return `<span class="sde-cell sde-mv ${over}">${WALK_SVG}${used}/${budget}ft</span>`;
  },
};
