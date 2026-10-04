// ItemBuilderApp, real template. Audit fixture. state: busy | empty
const names = ["Arrows (20)", "Backpack", "Caltrops", "Crowbar", "Flask of Oil of the Seven Winds", "Grappling Hook", "Iron Spikes (10)", "Lantern, Bullseye", "Mirror, Hand", "Rations (3)", "Rope, 60 ft."];
const items = names.map((name, i) => ({ idx: i, name, cost: `${i + 1} gp${i % 3 ? " 5 sp" : ""}`, slots: 1 + (i % 2), stats: i % 4 === 0 ? "1d6 · melee · versatile" : "", flag: i === 3 ? "Cost guessed" : "", description: i % 3 === 0 ? "" : "A sturdy and serviceable piece of adventuring gear that every delver packs before descending.", hasDesc: i % 3 !== 0 }));
const build = (state) => { const busy = state !== "empty"; return { context: {
  source: "Western Reaches Player's Guide", sourceList: ["Core Rulebook", "Cursed Scroll 1"], gearTypes: ["Basic", "Weapon", "Armor"].map((l, i) => ({ value: l, label: l, selected: i === 0 })), typeLabel: "Basic gear",
  tableText: busy ? "Arrows (20) 1 gp\nBackpack 2 gp" : "", descText: busy ? "Arrows. 20 arrows..." : "", tablePage: "58", descPage: "59-60", tablePdf: "x", descPdf: "x",
  items: busy ? items : [], itemCount: busy ? items.length : 0, dropped: busy ? [{ text: "Gear", reason: "heading" }, { text: "Cost Slots", reason: "header" }] : [], droppedCount: busy ? 2 : 0, withDesc: busy ? 7 : 0, needDesc: busy ? 4 : 0,
  systemDupes: busy ? ["Torch", "Rope"] : [], systemDupeCount: busy ? 2 : 0, report: busy ? { created: 5, replaced: 2 } : null } }; };
export default { id: "sde-item-builder", title: "SDE.importer.itemBuilder.title", icon: "fa-solid fa-boxes-stacked", classes: [], width: 760, height: 820, template: "templates/item-builder.hbs", initial: "busy", build, resizable: true, actions: {} };
