import current from "./audit-encounter-roller.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/encounter-roller.hbs": "tools/design-harness/proposed/templates/encounter-roller.hbs" }, { extraCss: "tools/design-harness/proposed/css/encounter-roller.css" }), compareState: "tables" };
