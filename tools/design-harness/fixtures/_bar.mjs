// Markup helpers matching scripts/shared/icons.mjs, so assembled bars match what the module writes.
export const gi = (n) => `<img class="sde-game-icon" src="modules/shadowdark-enhancer/icons/game-icons/${n}.svg" alt="">`;
export const fa = (n) => `<i class="fas fa-${n}"></i>`;
export const btn = (icon, label, o = {}) => `<button class="sde-bar-btn${o.cls ? " " + o.cls : ""}" data-action="${o.action ?? label.toLowerCase().replace(/\W+/g, "")}"${o.disabled ? ' disabled style="opacity:0.4;cursor:default"' : ""}>${icon} ${label}</button>`;
