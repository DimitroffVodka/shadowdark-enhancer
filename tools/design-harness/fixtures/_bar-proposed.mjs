// PROPOSAL, not shipped. One row in every mode: a badge, one primary action, at most three more, a Tools menu, End.
// Tools is one labelled panel (sections with names) instead of buttons that hide ten tools behind one word.
import { gi, fa, btn } from "./_bar.mjs";

export const css = `
#ui-middle{padding-top:330px}
.sde-bar-tools{position:relative;display:inline-block}
.sde-bar-menu{position:absolute;bottom:calc(100% + 8px);right:0;width:430px;padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px;
  background:var(--sde-bar-bg,#0b0b0b);border:1px solid #3a3a3a;border-radius:6px;box-shadow:0 6px 18px #000a;z-index:5}
.sde-bar-menu h4{margin:0 0 5px;font:700 11px/1 Signika,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:#888}
.sde-bar-menu-row{display:flex;flex-wrap:wrap;gap:5px}
.sde-bar-gap{flex:1}
`;

const tools = `<div class="sde-bar-tools">${btn(fa("toolbox"), "Tools &#9662;", { action: "tools" })}
  {{MENU}}</div>`;
const menu = (lead = "") => `<div class="sde-bar-menu">${lead}
  <section><h4>At the table</h4><div class="sde-bar-menu-row">${btn(gi("skull-crossed-bones"), "Encounter")}${btn(fa("dice"), "Roll tables")}${btn(gi("open-treasure-chest"), "Loot")}${btn(fa("wand-sparkles"), "Magic items")}${btn(fa("store"), "Merchant")}</div></section>
  <section><h4>Between sessions</h4><div class="sde-bar-menu-row">${btn(fa("star"), "Party XP")}${btn(fa("hammer"), "Downtime")}${btn(fa("graduation-cap"), "Training")}${btn(fa("crown"), "Renown")}${btn(fa("comments"), "Rumors")}${btn(fa("scroll"), "Recap")}${btn(fa("hand-fist"), "Pit fighting")}</div></section>
  <section><h4>Set up</h4><div class="sde-bar-menu-row">${btn(gi("open-book"), "Importer")}${btn(fa("chess-rook"), "Bastions")}</div></section>
</div>`;
const T = (open, lead) => tools.replace("{{MENU}}", open ? menu(lead) : "");

export const crawl = (state) => `<div id="shadowdark-enhancer-bar" class="shadowdark-enhancer-bar"><div class="sde-bar-inner sde-bar-active">
  <span class="sde-bar-phase-badge sde-bar-phase-crawl">${gi("flame")} Crawl · Round 4</span>
  ${btn(fa("chevron-right"), "Next round", { cls: "sde-bar-next-btn" })}
  ${btn(fa("user-plus"), "Add tokens")}
  ${btn(gi("crossed-swords"), "Combat", { cls: "sde-bar-combat-btn" })}
  <span class="sde-bar-gap"></span>
  ${T(state === "tools")}
  ${btn(fa("times"), "End", { cls: "sde-bar-danger-btn" })}
</div></div>`;

export const hex = (state) => `<div id="shadowdark-enhancer-bar" class="shadowdark-enhancer-bar"><div class="sde-bar-inner sde-bar-active">
  <span class="sde-bar-phase-badge sde-bar-phase-overland" title="Hex 2304, Forest, river">${fa("person-walking")} Forest · Fair · 3 of 4 hexes left</span>
  ${btn(fa("play"), "Continue", { cls: "sde-bar-next-btn" })}
  ${btn(fa("campground"), "Make camp")}
  <span class="sde-bar-gap"></span>
  ${T(state === "tools", `<section><h4>This travel day</h4><div class="sde-bar-menu-row">${btn(fa("sun"), "Start day")}${btn(fa("seedling"), "Forage")}${btn(fa("cloud-sun"), "Roll weather")}${btn(gi("flame"), "Start a crawl")}</div></section>`)}
  ${btn(fa("times"), "End travel", { cls: "sde-bar-danger-btn" })}
</div></div>`;
