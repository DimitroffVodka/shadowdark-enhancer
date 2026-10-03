/**
 * Shadowdark Enhancer — Crawl Bar, the parts that need no Foundry.
 *
 * Which controls the bar shows in each mode (one row, always) and what the
 * Tools panel holds. crawl-bar.mjs renders from these.
 */

/** The bar's own buttons, by the data-action each runs: ICONS key, en.json label and hover text, extra class. */
export const BUTTONS = {
  nextCrawlTurn:     { icon: "nextTurn", label: "SDE.crawlBar.nextRound", cls: "sde-bar-next-btn" },
  addSelectedTokens: { icon: "addTokens", label: "SDE.crawlBar.addTokens", tip: "SDE.crawlBar.addTokensCrawlTip" },
  startCombat:       { icon: "combat", label: "SDE.crawlBar.combat", cls: "sde-bar-combat-btn" },
  endCrawl:          { icon: "close", label: "SDE.crawlBar.end", tip: "SDE.crawlBar.endTip", cls: "sde-bar-danger-btn" },
  startCrawl:        { icon: "startCrawl", label: "SDE.crawlBar.start", tip: "SDE.crawlBar.startTip", cls: "sde-bar-start-btn" },
  startTravel:       { icon: "walking", label: "SDE.overland.startTravel", tip: "SDE.overland.startTravelHint" },
  resumeTravel:      { icon: "play", label: "SDE.overland.resume", tip: "SDE.overland.resumeHint", cls: "sde-bar-next-btn" },
  startDay:          { icon: "sunrise", label: "SDE.overland.startDay", tip: "SDE.overland.startDayHint", cls: "sde-bar-next-btn" },
  makeCamp:          { icon: "camp", label: "SDE.overland.makeCamp", tip: "SDE.overland.makeCampHint" },
  endTravel:         { icon: "close", label: "SDE.overland.endTravel", tip: "SDE.overland.endTravelHint", cls: "sde-bar-danger-btn" },
};

/**
 * The bar's controls, left to right, outside combat (combat has its own three).
 * "spacer" pushes what follows to the right edge. A control that does nothing in
 * a state is left out rather than drawn disabled.
 * @param {object} p
 * @param {"off"|"crawl"|"overland"} p.mode
 * @param {boolean} [p.hexScene]  the active scene is a hex map
 * @param {boolean} [p.pending]  overland: an encounter stopped the clock mid-move
 * @returns {string[]}  `badge`, `spacer`, `tools`, or the data-action a button runs
 */
export function barItems({ mode, hexScene = false, pending = false }) {
  if (mode === "overland") return ["badge", pending ? "resumeTravel" : "startDay", "makeCamp", "spacer", "tools", "endTravel"];
  if (mode === "crawl") return ["badge", "nextCrawlTurn", "addSelectedTokens", "startCombat", "spacer", "tools", "endCrawl"];
  return ["badge", "addSelectedTokens", ...(hexScene ? ["startTravel"] : []), "spacer", "tools", "startCrawl"];
}

/**
 * The Tools panel: labelled sections, each entry a data-action the bar already
 * runs. `icon` is a key of ICONS, `label` an en.json key. "This travel day" is
 * there only while travelling, Bastions once the world has one, and Reset
 * initiative only in a crawl (it is the Add Tokens right-click menu's item).
 * Forge & Loot's own window stays out until a generator it hosts works; it is
 * reachable meanwhile through game.shadowdarkEnhancer.forgeLoot.open().
 * @param {object} p
 * @param {"off"|"crawl"|"overland"} p.mode
 * @param {boolean} [p.hasBastion]
 * @returns {{id:string, label:string, entries:{action:string, icon:string, label:string, tip?:string}[]}[]}
 */
export function toolsSections({ mode, hasBastion = false }) {
  const e = (action, icon, label, tip) => ({ action, icon, label, tip });
  return [
    mode === "overland" && {
      id: "travelDay", label: "SDE.crawlBar.toolsMenu.travelDay",
      entries: [
        e("startDay", "sunrise", "SDE.overland.startDay", "SDE.overland.startDayHint"),
        e("forage", "forage", "SDE.overland.forage.button", "SDE.overland.forage.buttonHint"),
        e("rollWeather", "weather", "SDE.overland.rollWeather", "SDE.overland.rollWeatherHint"),
        e("startCrawl", "startCrawl", "SDE.crawlBar.toolsMenu.startCrawl"),
      ],
    },
    {
      id: "table", label: "SDE.crawlBar.toolsMenu.atTheTable",
      entries: [
        e("encounter", "encounter", "SDE.crawlBar.encounter", "SDE.crawlBar.encounterTip"),
        e("rollTables", "dice", "SDE.crawlBar.toolsMenu.rollTables"),
        e("lootGen", "forge", "SDE.crawlBar.toolsMenu.loot"),
        e("magicForge", "hammer", "SDE.crawlBar.toolsMenu.magicItems"),
        e("merchant", "merchant", "SDE.crawlBar.toolsMenu.merchant"),
        e("party", "heroes", "SDE.crawlBar.toolsMenu.party"),
        ...(mode === "crawl" ? [e("resetOocInit", "diceD20", "SDE.crawlBar.addTokensMenu.resetInit")] : []),
      ],
    },
    {
      id: "between", label: "SDE.crawlBar.toolsMenu.betweenSessions",
      entries: [
        e("partyXp", "star", "SDE.crawlBar.toolsMenu.partyXp"),
        e("downtime", "downtime", "SDE.crawlBar.toolsMenu.downtime"),
        e("training", "training", "SDE.crawlBar.toolsMenu.training"),
        e("renown", "gm", "SDE.crawlBar.toolsMenu.renown"),
        e("rumors", "rumors", "SDE.crawlBar.toolsMenu.rumors"),
        e("recap", "tableScroll", "SDE.crawlBar.toolsMenu.recap"),
        e("pitFighting", "pitFighting", "SDE.crawlBar.toolsMenu.pitFighting"),
      ],
    },
    {
      id: "setup", label: "SDE.crawlBar.toolsMenu.setUp",
      entries: [
        e("importer", "importer", "SDE.crawlBar.importer", "SDE.crawlBar.importerTip"),
        ...(hasBastion ? [e("bastions", "bastion", "SDE.crawlBar.bastions", "SDE.crawlBar.bastionsTip")] : []),
      ],
    },
  ].filter(Boolean);
}
