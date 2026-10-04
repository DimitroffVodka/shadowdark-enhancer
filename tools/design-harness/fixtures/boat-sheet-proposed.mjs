// Proposed Boat sheet in the shared UI kit. Same context and states as boat-sheet.mjs (the current fixture splices the
// runtime partial into a scratch template; the proposal is one flat template). Drop-in: same data-action / data-* / name=.
import fs from "node:fs";
import current from "./boat-sheet.mjs";
import { proposed } from "./_proposed.mjs";
const common = fs.readFileSync(new URL("../proposed/css/sheet-family.css", import.meta.url), "utf8");
const cur = { ...current, template: "templates/actors/boat-sheet.hbs", cssProposed: common, build: (s) => { const { template, css, ...rest } = current.build(s); return rest; } };
const out = proposed(cur, { "templates/actors/boat-sheet.hbs": "tools/design-harness/proposed/templates/boat-sheet.hbs" }, { width: 640 });
export default { ...out, compareState: "overview" };
