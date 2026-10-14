// HexExplorerApp (scripts/hex-map/hex-explorer-app.mjs): the GM's per-hex editor, in its busiest state (every
// collection has rows, long names, a long UUID). 480 x 620 is the window's real size; the body scrolls.
// Stands in for a painted hex tile: the real canvas is 932 x 810 with the hex (and its dark base) filling about half of it,
// so the margin the header zooms past is the real one. A flat pink hex with cracks, no Extras art shipped here.
const tile = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 932 810" width="932" height="810">
<polygon points="235,405 345,200 590,200 700,405 590,610 345,610" fill="#2a2a2a"/>
<polygon points="235,395 345,198 590,198 700,395 590,598 345,598" fill="#f1d9d6" stroke="#222" stroke-width="6"/>
<path d="M300 300 L420 360 L380 470 M520 250 L500 380 L620 420 M360 520 L470 470 L560 540" fill="none" stroke="#6b5a58" stroke-width="5"/>
</svg>`);
const uuid = "Compendium.shadowdark-enhancer--journals.JournalEntry.Fn82kQ0aXz91LmPq.JournalEntryPage.aB3dE5fG7hJ9kLmN";
const base = {
  previewHeight: 700, title: "SDE.hexExplorer.title", icon: "fa-solid fa-map", classes: ["shadowdark", "sde-hex-explorer", "sde-ui"],
  width: 480, height: 620, resizable: true, template: "templates/hex-map/hex-explorer.hbs",
  context: {
    isGM: true, saving: false, rootId: "sde-hex-explorer-x", sceneName: "The Western Reaches (A0 hex map)", number: "0417", artSrc: tile,
    terrain: "salt flat", enter: "Difficult (2)", region: "Rimespire Mountains (estimated)", title: "The Drowned Observatory of the Lantern Sisters",
    encounter: { uuid, name: "Lowland Moor Encounter Zone: Salt Flat (Night)", note: "A wandering check here rolls the Lowland Moor column \"Salt Flat (Night)\", as the clock reads now." },
    terrainOptions: ["forest", "grassland", "mountain", "salt flat", "swamp"].map((v) => ({ value: v, label: v, selected: v === "salt flat" })),
    lineRows: [["river", "River", true, true], ["path", "Path", false, false], ["coast", "Coast", true, false]].map(([type, label, checked, discovered]) => ({ type, label, checked, discovered })),
    features: [{ index: 0, type: "ruin", name: "The Collapsed Watchtower of Saint Verrin", uuid, discovered: true }, { index: 1, type: "lair", name: "Gnoll den", uuid: "", discovered: false }],
    notes: [{ index: 0, text: "A caravan route crosses here. Merchants pay double for lamp oil and will sell a map of the Salt Road.", visible: true, location: false }, { index: 1, text: "Hidden cellar under the third tower.", visible: false, location: true }],
    links: [{ index: 0, label: "Handout: the old map", uuid, visible: true }, { index: 1, label: "GM notes", uuid, visible: false }],
    keyedSection: true,
    keyed: [
      { uuid: "Compendium.world.sde-journal.JournalEntry.Fn82kQ0aXz91LmPq.JournalEntryPage.aB3dE5fG7hJ9kLmN", title: "1417 The Drowned Observatory of the Lantern Sisters" },
      { uuid: "JournalEntry.kQ1w2e3r4t5y6u7i.JournalEntryPage.zY8xW7vU6tS5rQ4p", title: "1417 The Sunken Bell" },
    ],
    keyedNote: "",
    revealed: true, visited: false, locationAuto: false, locationShow: true, locationHide: false,
  },
};
// state "scroll" (default) is the real 620px window; "full" lifts the height so the whole body can be seen;
// "empty" is a book known but not imported: the section says why instead of vanishing.
export default { ...base, initial: "scroll", build: (state) => (state === "full" ? { height: "auto" } : state === "stock" ? { context: { ...base.context, artSrc: null } } : state === "empty" ? { context: { ...base.context, keyed: [], keyedNote: "No key locations imported for this book." } } : {}) };
