// The bar while a combat is running (same capture as crawl-bar.mjs, taken after starting a combat).
export default { previewHeight: 170,
  title: "Crawl bar (combat)", width: 1009,
  html: `<div id="shadowdark-enhancer-bar" class="shadowdark-enhancer-bar"><div class="sde-bar-inner"><button class="sde-bar-btn sde-bar-danger-btn" data-action="endEncounter"><i class="fas fa-times"></i> End Encounter</button><button class="sde-bar-btn" data-action="addSelectedTokens" title="Add selected tokens to the combat tracker"><i class="fas fa-user-plus"></i> Add Tokens</button><button class="sde-bar-btn sde-bar-danger-btn" data-action="deleteEncounter"><i class="fas fa-times"></i> Delete Encounter</button></div></div>`,
};
