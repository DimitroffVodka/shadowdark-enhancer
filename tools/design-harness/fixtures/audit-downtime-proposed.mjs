import current from "./audit-downtime.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/downtime.hbs": "tools/design-harness/proposed/templates/downtime.hbs" }, { extraCss: "tools/design-harness/proposed/css/downtime.css" }), compareState: "solo" };
