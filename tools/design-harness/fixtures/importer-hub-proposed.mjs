// Importer Hub, proposed: four tabs (Paste / Preview / Manage / Tools) over the same dashboards, in the shared UI kit.
// States: paste | parsed | chars | tables | hexes | downtime | manage | tools   (the tab is derived from the state)
import current from "./importer-hub.mjs";
import { proposed } from "./_proposed.mjs";

const TAB = { paste: "paste", parsed: "preview", chars: "preview", tables: "preview", hexes: "preview", downtime: "preview", manage: "manage", tools: "tools" };
const base = proposed(current, { "templates/importer-hub.hbs": "tools/design-harness/proposed/templates/importer-hub.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/importer-hub.css", width: 860,
  strings: {
    "SDE.importer.ui.hubSub": "Paste text from your books, check what the parser found, then create it.",
    "SDE.importer.ui.tabPaste": "Paste", "SDE.importer.ui.tabPreview": "Preview",
    "SDE.importer.ui.emptyPreview": "Nothing parsed yet. Paste text on the Paste tab and press Parse.",
    "SDE.importer.ui.groupBooks": "Your books", "SDE.importer.ui.groupBackup": "Backup", "SDE.importer.ui.groupMaps": "Maps and adventures",
  },
});
const total = (d) => ["monstersCount", "itemsCount", "spellsCount", "tablesCount", "generatorsCount", "charsCount"].reduce((n, k) => n + (d[k] ?? 0), 0) + (d.hexCount ?? 0) + (d.boats?.length ?? 0);
export default {
  ...base, compareState: "parsed", initial: "paste",
  build: (state) => {
    const s = state === "preview" ? "parsed" : state;
    const r = base.build(s === "tools" ? "paste" : s);
    const ctx = r.context;
    return { ...r, context: { ...ctx, tab: TAB[s] ?? "paste", previewTotal: TAB[s] === "preview" ? total(ctx.importData) : 0 },
      toolbar: ["paste", "parsed", "chars", "tables", "hexes", "downtime", "manage", "tools"].map((x) => `<a href="?state=${x}" style="color:#9cf">${x}</a>`).join(" | ") };
  },
  actions: { hubTab: { state: "{tab}" } },
};
