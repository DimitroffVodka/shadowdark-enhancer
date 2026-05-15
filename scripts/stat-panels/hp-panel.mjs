export const hpPanel = {
  /**
   * @param {Actor} actor
   * @returns {string} HTML for one cell — Vagabond-style green progress bar with value/max overlay.
   */
  render(actor) {
    const hp = actor?.system?.attributes?.hp ?? { value: 0, max: 0 };
    const value = hp.value ?? 0;
    const max = Math.max(1, hp.max ?? 1);
    const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    const low = value <= 0 ? "sde-hp-low" : "";
    return `
      <div class="sde-cell sde-hp ${low}">
        <div class="sde-hp-bar" role="progressbar" aria-valuenow="${value}" aria-valuemax="${max}">
          <div class="sde-hp-bar-fill" style="width: ${pct}%"></div>
          <span class="sde-hp-bar-text">${value}/${max}</span>
        </div>
      </div>
    `;
  },
};
