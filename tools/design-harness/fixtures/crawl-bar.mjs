// Captured from the live world (Western Reaches Test, crawl active, round 0) with the bridge's evaluate:
//   document.querySelector(".shadowdark-enhancer-bar").outerHTML
// The bar is built in JS (scripts/crawl-bar/crawl-bar.mjs), so this is a still of its markup, not its logic.
export default { previewHeight: 170,
  title: "Crawl bar", width: 1009,
  html: `<div id="shadowdark-enhancer-bar" class="shadowdark-enhancer-bar">
      <div class="sde-bar-inner sde-bar-active">
        <span class="sde-bar-phase-badge sde-bar-phase-crawl">
          <img class="sde-game-icon" src="modules/shadowdark-enhancer/icons/game-icons/flame.svg" alt=""> Crawl · Round 0
        </span>
        <button class="sde-bar-btn sde-bar-next-btn" data-action="nextCrawlTurn"><i class="fas fa-chevron-right"></i> Next Round</button>
        <button class="sde-bar-btn" data-action="addSelectedTokens" title="Add selected tokens to the crawl"><i class="fas fa-user-plus"></i> Add Tokens</button>
        <button class="sde-bar-btn sde-bar-combat-btn" data-action="startCombat"><img class="sde-game-icon" src="modules/shadowdark-enhancer/icons/game-icons/crossed-swords.svg" alt=""> Combat</button>
        <button class="sde-bar-btn" data-action="encounter"><img class="sde-game-icon" src="modules/shadowdark-enhancer/icons/game-icons/skull-crossed-bones.svg" alt=""> Encounter</button>
        <button class="sde-bar-btn" data-action="loot"><img class="sde-game-icon" src="modules/shadowdark-enhancer/icons/game-icons/open-treasure-chest.svg" alt=""> Forge &amp; Loot</button>
        <button class="sde-bar-btn" data-action="rollTables"><img class="sde-game-icon" src="modules/shadowdark-enhancer/icons/game-icons/open-book.svg" alt=""> Importer</button>
        <button class="sde-bar-btn" data-action="bastions"><i class="fas fa-chess-rook"></i> Bastions</button>
        <button class="sde-bar-btn sde-bar-danger-btn" data-action="endCrawl"><i class="fas fa-times"></i> End</button>
      </div></div>`,
};
