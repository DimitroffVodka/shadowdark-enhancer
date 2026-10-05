// ClassImporterApp, real template. Audit fixture.  state: busy (class created, stage 2 filled) | body (pasting stage 1, with preview) | empty
const feats = [{ name: "Patron Bond", html: "You forge a pact with a patron of your choice and gain a boon each time you rest in a place sacred to it." }, { name: "Eldritch Spark", html: "Once per round add <b>1d4</b> damage to a spell attack." }, { name: "Cursed Inheritance", html: "On a natural 1 on a spellcasting check the patron takes a small payment." }];
const talents = [["2", "Gain +2 to Intelligence or Charisma rolls", true], ["3-6", "Gain a Patron boon", true], ["7-9", "+1 to spellcasting checks", false], ["10-11", "Choose a talent or +2 points to distribute among your stats", false], ["12", "Choose a talent or +2 points", true]].map(([range, text, wired], i) => ({ idx: i, range, text, wired, wiredVia: "talent", wiredMatch: "Ability Score" }));
const titles = [["1-2", "Pawn", "Cultist", "Acolyte"], ["3-4", "Scholar", "Blighter", "Adept"], ["5-6", "Archivist of the Hidden Library", "Herald", "Seeker"], ["7-8", "Warden", "Dread", "Mage"], ["9-10", "Lord", "Tyrant", "Sage"]].map(([range, lawful, chaotic, neutral], i) => ({ idx: i, range, lawful, chaotic, neutral, flagged: i === 2, flagReason: "Titles row 5: check text" }));
const spells = [1, 2, 3, 4, 5, 6].map((l, i) => ({ idx: i, level: l, t1: 2 + i, t2: i > 1 ? 1 : "", t3: i > 3 ? 1 : "", t4: "", t5: "" }));
const build = (state) => {
  const empty = state === "empty", body = state === "body", busy = state === "busy";
  return { context: {
    source: "Western Reaches Player's Guide", sourceList: ["Core Rulebook", "Cursed Scroll 1", "Western Reaches"], bodyText: body ? "WARLOCK\nHit points: 1d6 per level\nWeapons: dagger, crossbow..." : "",
    bodyPreview: body ? { name: "Warlock", hp: "d6", features: feats, weapons: "dagger, shortsword, crossbow", armor: "leather armor, chainmail", isCaster: true, hasTables: true, warnings: ["No TALENTS table found - BLOCKER"] } : null,
    created: busy, editingBody: false, showBody: !busy, className: busy ? "Warlock of the Sundered Crown" : "", bodyName: body ? "Warlock" : "", displayName: busy ? "Warlock of the Sundered Crown" : "Warlock", displayNameHtml: "Warlock",
    isCaster: true, detectedTables: body ? ["Talent table (11 rows)", "Titles (5 bands)", "Spells known (6 levels)"] : [],
    talent: busy ? { rows: 5, formula: "2d6", wiredCount: 3, entries: talents } : null, titles: busy ? titles : [], titlesCount: busy ? 5 : 0, titleWarnings: busy ? ["Titles row 5: lawful and chaotic look swapped"] : [],
    spells: busy ? { rows: 6, entries: spells } : null,
    extras: busy ? [{ idx: 0, name: "Patron Corruption", formula: "1d6", entries: [{ idx: 0, range: "1", text: "Your shadow moves on its own" }, { idx: 1, range: "2", text: "Your eyes glow faintly in the dark" }] }] : [],
    seedClassName: body ? "Warlock" : null, seedClassNameHtml: "Warlock", writeupPdf: body || busy ? "x" : null, writeupPage: "34", titlesPdf: busy ? "x" : null, titlesPage: "112",
    imported: busy ? { talentRows: 5, titles: 5, spells: 6, extras: ["Patron Corruption"] } : null, hasStage2: busy, pending: busy ? "2 tables" : "Nothing yet", canAttach: busy,
    report: busy ? { created: 12, updated: 3 } : null,
  } };
};
export default { id: "sde-class-importer", title: "SDE.importer.classImporter.title", icon: "fa-solid fa-hat-wizard", classes: ["sde-ui", "sde-imp"], width: 720, height: 800, template: "templates/class-importer.hbs", initial: "busy", build, resizable: true, actions: {} };
