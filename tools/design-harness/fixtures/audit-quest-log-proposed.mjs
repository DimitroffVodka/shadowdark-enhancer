import current from "./audit-quest-log.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/quest-log.hbs": "tools/design-harness/proposed/templates/quest-log.hbs" }, { extraCss: "tools/design-harness/proposed/css/quest-log.css" }), compareState: "gm" };
