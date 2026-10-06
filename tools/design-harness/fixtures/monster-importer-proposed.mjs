import current from "./monster-importer.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/monster-importer.hbs": "tools/design-harness/proposed/templates/monster-importer.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/monster-importer.css", width: 860,
  strings: { "SDE.importer.ui.monsterSub": "Paste stat blocks from your book, check the parsed fields, then create the monsters.",
    "SDE.importer.ui.monsterPastePlaceholder": "ENHANCED SYNTHETIC\nA glass-and-brass training construct built to exercise the importer.\nAC 13, HP 9, ATK 1 calibration beam +3 (1d6), MV near, S +1, D +2, C +1, I +0, W +0, Ch -2, AL N, LV 2\nAdaptive Plating. Gains +1 AC after it is hit, until the start of its next turn." } }), compareState: "busy" };
