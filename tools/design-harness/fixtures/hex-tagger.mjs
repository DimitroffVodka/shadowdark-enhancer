// The Hex Tagger mid-job: every gate open, one sheet of hexes. The busiest state a GM sees.
const terrains = ["Forest", "Hills", "Mountains", "Plains", "Swamp", "Water", "Desert"];
const opts = (sel) => terrains.map((l) => ({ value: l.toLowerCase(), label: l, selected: l === sel }));
const px = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><polygon points="48,4 90,26 90,70 48,92 6,70 6,26" fill="#5a7a4a" stroke="#222" stroke-width="3"/></svg>');
const sheet = Array.from({ length: 12 }, (_, i) => ({
  i, j: i, num: 1200 + i, label: String(1200 + i).padStart(4, "0"), thumb: px, keyed: i % 5 === 0, source: i % 3 ? "auto" : "", margin: i % 3 ? "0.4" : "", review: i % 4 === 1,
  terrainOptions: opts(terrains[i % terrains.length]), terrainOther: "", features: { river: i % 4 === 0, path: false, coast: i % 6 === 0 },
}));
const base = {
  title: "SDE.hexMap.app.title", icon: "fa-solid fa-map-location-dot", classes: ["shadowdark", "sde-hex-tagger", "sde-ui"], resizable: true,
  width: 980, template: "templates/hex-tagger.hbs",
  context: {
    sceneName: "Western Reaches GM Map A0", sampled: true, numberedCount: 4736, cellCount: 4736, summary: { tagged: 311, gm: 24, auto: 287, untagged: 4425 },
    a0: true, origin: { num: 1 }, primaryPlayable: false, primaryLegend: true, canClassify: true, canSheet: true,
    modes: [["random", "Random"], ["keyed", "Keyed"], ["review", "Review"]].map(([value, label]) => ({ value, label, selected: value === "random" })),
    hasKey: true, allCrawls: true, entries: [{ uuid: "a", name: "Western Reaches key locations" }], hasRegions: true, hasTags: true, overlayMode: "terrain", viaExtras: false,
    showMore: true, artCount: 3, anchorNum: "0001", originText: "grid 0,0", boundsCols: 83, boundsRows: 57, sensitivity: 1, progress: "",
    palette: { open: false, set: true, terms: terrains.map((label) => ({ value: label.toLowerCase(), label, checked: true })) },
    baseline: { right: 88, checked: 120, accuracy: 73, worst: [["hills", 9], ["plains", 6]] },
    legendLog: { cards: 14, named: 11, skipped: 3, opened: 2 },
    report: { wrong: 14, judged: 120, caught: 9, suggested: 0.6, suggestedCount: 41 }, reviewMargin: "0.50", reviewCount: 52,
    sheet, hasSheet: true, hasLegend: false,
  },
};
// The tabs are hidden radios: state = the tab shown (sheet | map | terrains | data | settings).
const tabs = ["sheet", "map", "terrains", "data", "settings"];
export default { initial: "sheet", build: (state) => ({ ...base, context: { ...base.context, tab: state } }),
  toolbar: tabs.map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join(""), actions: { s: { state: "{state}" } } };
