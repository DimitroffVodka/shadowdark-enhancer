// HexExplorerApp (scripts/hex-map/hex-explorer-app.mjs): the GM's per-hex editor, in its busiest state (every
// collection has rows, long names, a long UUID). 480 x 620 is the window's real size; the body scrolls.
const uuid = "Compendium.shadowdark-enhancer--journals.JournalEntry.Fn82kQ0aXz91LmPq.JournalEntryPage.aB3dE5fG7hJ9kLmN";
const base = {
  previewHeight: 700, title: "SDE.hexExplorer.title", icon: "fa-solid fa-map", classes: ["shadowdark", "sde-hex-explorer", "sde-ui"],
  width: 480, height: 620, resizable: true, template: "templates/hex-map/hex-explorer.hbs",
  context: {
    isGM: true, saving: false, rootId: "sde-hex-explorer-x", sceneName: "The Western Reaches (A0 hex map)", number: "0417",
    terrain: "salt flat", title: "The Drowned Observatory of the Lantern Sisters",
    terrains: ["forest", "grassland", "mountain", "swamp", "salt flat"],
    lineRows: [["river", "River", true, true], ["path", "Path", false, false], ["coast", "Coast", true, false]].map(([type, label, checked, discovered]) => ({ type, label, checked, discovered })),
    features: [{ index: 0, type: "ruin", name: "The Collapsed Watchtower of Saint Verrin", uuid, discovered: true }, { index: 1, type: "lair", name: "Gnoll den", uuid: "", discovered: false }],
    notes: [{ index: 0, text: "A caravan route crosses here. Merchants pay double for lamp oil and will sell a map of the Salt Road.", visible: true, location: false }, { index: 1, text: "Hidden cellar under the third tower.", visible: false, location: true }],
    links: [{ index: 0, label: "Handout: the old map", uuid, visible: true }, { index: 1, label: "GM notes", uuid, visible: false }],
    revealed: true, visited: false, locationAuto: false, locationShow: true, locationHide: false,
  },
};
// state "scroll" (default) is the real 620px window; state "full" lifts the height so the whole body can be seen.
export default { ...base, initial: "scroll", build: (state) => (state === "full" ? { height: "auto" } : {}) };
