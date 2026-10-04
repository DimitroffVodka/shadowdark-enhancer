// Proposed Bastion sheet in the shared UI kit: header band with the four numbers, four tabs, the rooms at work folded,
// upgrade cards with icon actions. Same context and states as bastion-sheet.mjs. Drop-in: same data-action / data-* / name=
// and the same .sde-bastion-map, .sde-bastion-card, [data-card], select[data-bastion-type] hooks the sheet's JS binds.
import fs from "node:fs";
import current from "./bastion-sheet.mjs";
import { proposed } from "./_proposed.mjs";
const common = fs.readFileSync(new URL("../proposed/css/sheet-family.css", import.meta.url), "utf8");
const cur = { ...current, cssProposed: common, build: (s) => { const { template, css, ...rest } = current.build(s); return rest; } };
const out = proposed(cur, { "templates/actors/bastion-sheet.hbs": "tools/design-harness/proposed/templates/bastion-sheet.hbs" }, { width: 860, extraCss: "tools/design-harness/proposed/css/bastion-sheet.css" });
export default { ...out, compareState: "upgrades" };
