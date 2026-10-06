// Proposed Extra Gear editor in the shared UI kit: no inline <style>, folders as kit accordions, Save is the one primary.
// Same context as gear-editor.mjs. Drop-in: same .sde-ege-filter / .sde-ege-source / .sde-ege-folder / .sde-ege-row /
// .sde-gear-pick / .sde-ege-count hooks and data-action names.
import fs from "node:fs";
import current from "./gear-editor.mjs";
import { proposed } from "./_proposed.mjs";
const common = fs.readFileSync(new URL("../proposed/css/sheet-family.css", import.meta.url), "utf8");
export default proposed({ ...current, cssProposed: common }, { "templates/char-builder/gear-editor.hbs": "tools/design-harness/proposed/templates/gear-editor.hbs" }, { width: 560, strings: { "SDE.ui.gearEditorNote": "Tick the items players can buy in the builder shop. Default stock is always on." }, extraCss: "tools/design-harness/proposed/css/gear-editor.css" });
