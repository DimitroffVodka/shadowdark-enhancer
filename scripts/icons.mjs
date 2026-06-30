/**
 * Shadowdark Enhancer — Centralized Icon Registry
 *
 * Forked from vagabond-crawler/scripts/icons.mjs.
 *
 * Every icon used in the module is defined here.
 * To swap any icon, change its HTML snippet below:
 *
 *   FontAwesome:  `<i class="fas fa-icon-name"></i>`
 *   Custom SVG:   `<img class="sde-icon" src="${P}/my-icon.svg" alt="" />`
 *
 * SVG files live in  modules/shadowdark-enhancer/icons/
 */

const P = "modules/shadowdark-enhancer/icons";

export const ICONS = {

  // ── Crawl Bar ────────────────────────────────────────────────────────────
  startCrawl:  `<i class="fas fa-dungeon"></i>`,
  heroes:      `<i class="fas fa-users"></i>`,
  gm:          `<i class="fas fa-crown"></i>`,
  nextTurn:    `<i class="fas fa-chevron-right"></i>`,
  addTokens:   `<i class="fas fa-user-plus"></i>`,
  encCheck:    `<i class="fas fa-dice-d6"></i>`,
  encounter:   `<img class="sde-bar-icon" src="${P}/light-sabers.svg" alt="" />`,
  tableScroll: `<i class="fas fa-scroll"></i>`,
  lights:      `<i class="fas fa-fire"></i>`,
  combat:      `<i class="fas fa-swords"></i>`,
  close:       `<i class="fas fa-times"></i>`,
  play:        `<i class="fas fa-play"></i>`,
  clock:       `<i class="fas fa-clock" style="font-size:20px;color:var(--sde-bar-accent)"></i>`,

  // ── Clock Menu ───────────────────────────────────────────────────────────
  rollBack:    `<i class="fas fa-backward"></i>`,
  configure:   `<i class="fas fa-cog"></i>`,

  // ── Encounter Roller ─────────────────────────────────────────────────────
  diceD20:     `<i class="fas fa-dice-d20"></i>`,
  save:        `<i class="fas fa-save"></i>`,
  hammer:      `<i class="fas fa-hammer"></i>`,
  table:       `<i class="fas fa-table"></i>`,
  star:        `<i class="fas fa-star"></i>`,
  dice:        `<i class="fas fa-dice"></i>`,
  comment:     `<i class="fas fa-comment"></i>`,
  mapPin:      `<i class="fas fa-map-pin"></i>`,
  folderMinus: `<i class="fas fa-folder-minus"></i>`,
  clearX:      `<i class="fas fa-times"></i>`,

  // ── Strip ────────────────────────────────────────────────────────────────
  shamrock:    `<img class="sde-bar-icon-shamrock" src="${P}/shamrock.svg" alt="" />`,
  walking:     `<i class="fas fa-person-walking"></i>`,
  flying:      `<i class="fas fa-dove"></i>`,
  swimming:    `<i class="fas fa-person-swimming"></i>`,
  climbing:    `<i class="fas fa-hands-holding"></i>`,
  phasing:     `<i class="fas fa-ghost"></i>`,
  clinging:    `<i class="fas fa-spider"></i>`,
  skull:       `<i class="fas fa-skull"></i>`,
  gmCrown:     `<i class="fas fa-crown sde-strip-gm-icon"></i>`,
  turnArrow:   `<i class="fas fa-chevron-right"></i>`,
  activate:    `<i class="fas fa-play"></i>`,
  deactivate:  `<i class="fas fa-circle-xmark"></i>`,
  prevRound:   `<i class="fas fa-angle-up"></i>`,
  nextRound:   `<i class="fas fa-angle-down"></i>`,

  // ── Movement ─────────────────────────────────────────────────────────────
  rollbackMove: `<i class="fas fa-rotate-left"></i>`,

  // ── Chat Messages ────────────────────────────────────────────────────────
  encounterChat: `<img class="sde-bar-icon-dragon" src="${P}/light-sabers.svg" alt="" />`,
};
