// Proposed Mount sheet in the shared UI kit. Same context and states as mount-npc.mjs; five tabs (Spells, Description and
// Effects are one grouped tab with a switch). Drop-in: same data-action / data-* / name= as templates/actors/mount-sheet.hbs.
import fs from "node:fs";
import current from "./mount-npc.mjs";
import { proposed } from "./_proposed.mjs";
const common = fs.readFileSync(new URL("../proposed/css/sheet-family.css", import.meta.url), "utf8");
const cur = { ...current, cssProposed: common, build: (s) => { const { template, css, ...rest } = current.build(s); return rest; },
  strings: { "SDE.ui.mountMore": "More", "SDE.ui.spellsEmpty": "No spells yet. Use the plus to add one.", "SDE.ui.effectsEmpty": "No active effects. Pick a pre-defined one or use the plus." } };
const out = proposed(cur, { "templates/actors/mount-sheet.hbs": "tools/design-harness/proposed/templates/mount-sheet.hbs" }, { width: 640, strings: cur.strings });
export default { ...out, compareState: "mount" };
