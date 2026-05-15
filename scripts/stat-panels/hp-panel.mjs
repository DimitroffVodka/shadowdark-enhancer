export const hpPanel = {
  /**
   * @param {Actor} actor
   * @returns {string} HTML for one cell
   */
  render(actor) {
    const hp = actor?.system?.attributes?.hp ?? { value: 0, max: 0 };
    const low = (hp.value ?? 0) <= 0 ? "sde-hp-low" : "";
    return `<span class="sde-cell sde-hp ${low}">HP ${hp.value ?? 0}/${hp.max ?? 0}</span>`;
  },
};
