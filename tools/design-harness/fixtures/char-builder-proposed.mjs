// Proposed Character Builder in the shared UI kit. The look is the current builder's (kit dark = its palette); only the
// structure changes: one ui-h line per step instead of the double-bordered H1 band, a two-column Class step with folded
// sections, readable used-dice chips, ability guides folded, art actions folded, one primary (Create Character).
// The real step partials are registered under short names at runtime; here each proposed partial is inlined under the same
// name ({{#*inline}}) so the frame's {{> (lookup . 'stepPartial')}} stays as it is. Contexts are the current fixture's.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import current from "./char-builder.mjs";
import { proposed } from "./_proposed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DIR = path.join(ROOT, "tools/design-harness/proposed/templates/char-builder");
const SCRATCH = "/tmp/claude-1000/-home-patricks-git-shadowdark-enhancer/d0efba86-ed4a-4173-b027-7af1159d99a1/scratchpad/tpl";
fs.mkdirSync(SCRATCH, { recursive: true });
const NAMES = ["list", "stats", "ancestry", "origins", "class", "hp", "gold", "hp-gold", "gear", "preview", "languages"];
const inline = NAMES.map((n) => `{{#*inline "sde-cb-${n}"}}${fs.readFileSync(path.join(DIR, n + ".hbs"), "utf8")}{{/inline}}`).join("\n");
const composed = path.join(SCRATCH, "char-builder-proposed-composed.hbs");
fs.writeFileSync(composed, inline + "\n" + fs.readFileSync(path.join(DIR, "frame.hbs"), "utf8"));

const common = fs.readFileSync(new URL("../proposed/css/sheet-family.css", import.meta.url), "utf8");
const strings = {
  "SDE.ui.changeArt": "Change artwork",
  "SDE.charBuilder.hp.con": "CON ({mod})",
  "SDE.charBuilder.gold.formulaDice": "2d6 × 5",
};
const cur = { ...current, template: "templates/char-builder/char-builder.hbs", cssProposed: common, strings,
  build: (s) => { const { template, css, ...rest } = current.build(s); const id = rest.context.stepId;
    return { ...rest, context: { ...rest.context, stepPartial: "sde-cb-" + (id === "hp" ? "hp-gold" : id) } }; } };
const out = proposed(cur, { "templates/char-builder/char-builder.hbs": path.relative(ROOT, composed) }, { width: 1040, extraCss: "tools/design-harness/proposed/css/char-builder.css", strings });
export default { ...out, compareState: "class" };
