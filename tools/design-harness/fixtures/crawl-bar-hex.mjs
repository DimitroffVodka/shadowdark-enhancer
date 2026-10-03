// The bar in overland (hex) mode, assembled from scripts/crawl-bar/crawl-bar.mjs render(): travel day open, a day
// pending (so Continue shows), bastion present, no crawl running (so Start shows). The busiest state the bar reaches.
import { gi, fa, btn } from "./_bar.mjs";
export default { previewHeight: 210,
  title: "Crawl bar (hex mode, current)", width: 1009,
  html: `<div id="shadowdark-enhancer-bar" class="shadowdark-enhancer-bar"><div class="sde-bar-inner sde-bar-active">
    <span class="sde-bar-phase-badge sde-bar-phase-overland">${fa("person-walking")} Weather: Fair · 3 of 4 hexes left</span>
    ${btn(fa("chevron-right"), "Next Round", { cls: "sde-bar-next-btn", disabled: true })}
    ${btn(fa("user-plus"), "Add Tokens")}
    ${btn(gi("crossed-swords"), "Combat", { cls: "sde-bar-combat-btn", disabled: true })}
    ${btn(gi("skull-crossed-bones"), "Encounter")}
    ${btn(gi("open-treasure-chest"), "Forge &amp; Loot")}
    ${btn(gi("open-book"), "Importer")}
    ${btn(fa("chess-rook"), "Bastions")}
    ${btn(fa("play"), "Continue", { cls: "sde-bar-start-btn" })}
    ${btn(fa("sun"), "Start day")}
    ${btn(fa("seedling"), "Forage")}
    ${btn(fa("campground"), "Make camp")}
    ${btn(fa("cloud-sun"), "Weather")}
    ${btn(fa("times"), "End travel", { cls: "sde-bar-danger-btn" })}
    ${btn(gi("flame"), "Start", { cls: "sde-bar-start-btn" })}
  </div></div>`,
};
