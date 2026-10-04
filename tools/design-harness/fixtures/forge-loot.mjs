// Forge & Loot, GM only. state: preview (busiest: inputs + warnings + exclusions + a full preview with members),
// blocked (missing inputs + an error), idle (no generator picked). Context shape is ForgeLootApp._prepareContext's.
const generators = [{ id: "npc", label: "Ordinary NPC", description: "One seeded NPC with gear, coins and a motive.", icon: "fa-user", selected: true },
  { id: "rival", label: "Rival Crawlers", description: "A party of rival adventurers drawn from the imported classes table.", icon: "fa-users", selected: false }];
const fields = [
  { key: "name", label: "Name", hint: "Leave blank to roll one", type: "text", isCheckbox: false, isSelect: false, isTextarea: false, required: false, placeholder: "Random", value: "", checked: false, options: [] },
  { key: "level", label: "Level", hint: "", type: "number", isCheckbox: false, isSelect: false, isTextarea: false, required: true, placeholder: "", value: 4, checked: false, options: [] },
  { key: "ancestry", label: "Ancestry", hint: "", type: "select", isCheckbox: false, isSelect: true, isTextarea: false, required: false, placeholder: "", value: "dwarf", checked: false, options: ["Any", "Dwarf", "Elf", "Goblin", "Halfling", "Half-orc", "Human"].map((l) => ({ value: l.toLowerCase(), label: l, selected: l === "Dwarf" })) },
  { key: "notes", label: "Table notes", hint: "Shown on the NPC's journal page", type: "textarea", isCheckbox: false, isSelect: false, isTextarea: true, required: false, placeholder: "Anything the GM should remember", value: "", checked: false, options: [] },
  { key: "makeJournal", label: "Create a journal page", hint: "", type: "checkbox", isCheckbox: true, isSelect: false, isTextarea: false, required: false, placeholder: "", value: true, checked: true, options: [] },
];
const diag = (code, message, evidence = "") => ({ code, message, evidence });
const preview = {
  title: "Brannock Ironmead, dwarf Fighter 4", summary: "Complete proposal. Nothing is written until you approve it.",
  sections: [
    { title: "Stats", rows: [["Level", "4"], ["HP", "27"], ["AC", "16 (chainmail, shield)"], ["Alignment", "Lawful"], ["Background", "Disgraced mine foreman who lost his crew to a cave-in he blames on the guild"]].map(([label, value]) => ({ label, value })), items: [] },
    { title: "Gear", rows: [], items: [{ label: "Warhammer +1", detail: "1d8, versatile" }, { label: "Chainmail", detail: "AC 13 + DEX" }, { label: "Shield", detail: "+1 AC" }, { label: "Potion of Healing", detail: "x2" }, { label: "Rope, 60 feet", detail: "" }, { label: "Gem: Black opal", detail: "100 gp" }] },
    { title: "Coins", rows: [{ label: "Purse", value: "34 gp, 12 sp, 5 cp" }], items: [] },
  ],
  members: [{ name: "Brannock Ironmead", detail: "Fighter 4" }, { name: "Dessa Quickfingers", detail: "Thief 3, hireling" }, { name: "Old Pennywhistle", detail: "Mule" }],
};
const base = { phase: "preview", phaseLabel: "preview", seed: "Kx9aQ2mTbW41", rerollCount: 3, generator: "npc", generators, hasGenerator: true, generatorLabel: "Ordinary NPC", generatorDescription: "One seeded NPC with gear, coins and a motive.", fields,
  preview, hasPreview: true, canPreview: true, canApprove: true, canReroll: true, canCancel: true, isPlanning: false, isBlocked: false, isDisabled: false, isCommitting: false, isCommitted: false, isCancelled: false, statusMessage: "", error: null, result: null,
  diagnostics: { missing: [], exclusions: [diag("EXCL_CLASS", "Two classes were skipped because their spell lists are not imported.", "Wizard, Seer")], warnings: [diag("LOW_COINS", "The coin total is below the table's usual range for level 4.", "34 gp vs 60-120 gp"), diag("DUP_GEAR", "Chainmail and Shield both name the same source row.", "core-gear-12")] } };
const build = (state) => state === "blocked"
  ? { context: { ...base, phase: "blocked", phaseLabel: "blocked", isBlocked: true, hasPreview: false, preview: null, canApprove: false, canPreview: false, statusMessage: "Preview could not be generated.",
      diagnostics: { missing: [diag("MISSING_TABLE", "The ancestry roll table is not imported.", "shadowdark-enhancer--roll-tables / Ancestry Names"), diag("MISSING_CLASSES", "No classes are imported, so the Rival generator has nothing to draw from.")], exclusions: [], warnings: [] },
      error: diag("PLAN_FAILED", "The planner threw while reading the source snapshot.", "TypeError: cannot read properties of undefined (reading 'rows')") } }
  : state === "idle" ? { context: { ...base, phase: "idle", phaseLabel: "idle", generator: "", hasGenerator: false, generators: generators.map((g) => ({ ...g, selected: false })), hasPreview: false, preview: null, canPreview: false, canApprove: false, canReroll: false, fields: [], diagnostics: { missing: [], exclusions: [], warnings: [] } } }
  : { context: base };
export default {
  title: "SDE.forgeLoot.title", icon: "fas fa-hammer", classes: [], resizable: true, width: 760, template: "templates/forge-loot.hbs", initial: "preview", build,
  toolbar: `<span>State:</span>${["preview", "blocked", "idle"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`, actions: { s: { state: "{state}" } },
};
