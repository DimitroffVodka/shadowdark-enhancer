// Proposed Bastion panel in the shared UI kit: two cards a row, per-card actions as icons, one primary (New bastion).
// Same context and states as bastion-panel.mjs. Drop-in: same data-action / data-id hooks.
import fs from "node:fs";
import current from "./bastion-panel.mjs";
import { proposed } from "./_proposed.mjs";
const common = fs.readFileSync(new URL("../proposed/css/sheet-family.css", import.meta.url), "utf8");
const cur = { ...current, cssProposed: common };
const out = proposed(cur, { "templates/bastion-panel.hbs": "tools/design-harness/proposed/templates/bastion-panel.hbs" }, { width: 720, extraCss: "tools/design-harness/proposed/css/bastion-panel.css" });
export default { ...out, compareState: "gm" };
