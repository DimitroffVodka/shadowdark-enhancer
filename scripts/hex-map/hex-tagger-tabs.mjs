/** The Hex Tagger's tabs, in display order, and the context flag that makes each one available. */
export const TAGGER_TABS = [
  { id: "sheet", needs: null },
  { id: "map", needs: null },
  { id: "terrains", needs: "origin" },
  { id: "data", needs: "showMore" },
  { id: "settings", needs: "origin" },
];

/** The tab to show: the one asked for if it exists for this scene, else the first (Sheet). */
export function resolveTab(wanted, available = {}) {
  const tab = TAGGER_TABS.find((t) => t.id === wanted);
  return tab && (!tab.needs || available[tab.needs]) ? tab.id : TAGGER_TABS[0].id;
}
