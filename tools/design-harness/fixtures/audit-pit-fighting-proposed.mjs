import current from "./audit-pit-fighting.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/pit-fighting.hbs": "tools/design-harness/proposed/templates/pit-fighting.hbs" }, { extraCss: "tools/design-harness/proposed/css/pit-fighting.css" }), compareState: "result" };
