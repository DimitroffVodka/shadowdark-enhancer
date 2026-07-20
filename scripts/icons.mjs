/**
 * Shadowdark Enhancer — centralized icon registry.
 *
 * Every icon used in the module is defined here. To swap one, change its HTML
 * snippet below:
 *
 *   FontAwesome:  `<i class="fas fa-icon-name"></i>`
 *   Vendored SVG: `gameIcon("slug")` → icons/game-icons/<slug>.svg
 *
 * All SVGs are vendored inside this module (icons/) — never fetched from an
 * external URL or another module/system.
 */

const P = "modules/shadowdark-enhancer/icons";
// CC BY 3.0 game-icons.net SVGs vendored under icons/game-icons/.
const gameIcon = (slug) => `<img class="sde-game-icon" src="${P}/game-icons/${slug}.svg" alt="" />`;

export const ICONS = {

  // ── Crawl Bar ────────────────────────────────────────────────────────────
  startCrawl:  gameIcon("flame"),
  heroes:      `<i class="fas fa-users"></i>`,
  gm:          `<i class="fas fa-crown"></i>`,
  nextTurn:    `<i class="fas fa-chevron-right"></i>`,
  addTokens:   `<i class="fas fa-user-plus"></i>`,
  encCheck:    gameIcon("perspective-dice-six-faces-random"),
  encounter:   gameIcon("skull-crossed-bones"),
  tableScroll: `<i class="fas fa-scroll"></i>`,
  lights:      `<i class="fas fa-fire"></i>`,
  combat:      gameIcon("crossed-swords"),
  forge:       gameIcon("open-treasure-chest"),
  importer:    gameIcon("open-book"),
  charBuilder: gameIcon("visored-helm"),
  monsterArt:  gameIcon("dragon-head"),
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
  torch:       `<i class="fas fa-fire"></i>`,
  gmCrown:     `<i class="fas fa-crown sde-strip-gm-icon"></i>`,
  turnArrow:   `<i class="fas fa-chevron-right"></i>`,
  activate:    `<i class="fas fa-play"></i>`,
  deactivate:  `<i class="fas fa-circle-xmark"></i>`,
  prevRound:   `<i class="fas fa-angle-up"></i>`,
  nextRound:   `<i class="fas fa-angle-down"></i>`,

  // ── Movement ─────────────────────────────────────────────────────────────
  rollbackMove: `<i class="fas fa-rotate-left"></i>`,

  // ── Chat Messages ────────────────────────────────────────────────────────
  encounterChat: gameIcon("skull-crossed-bones"),
};
