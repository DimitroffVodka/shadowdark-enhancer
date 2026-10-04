import current from "./magic-forge.mjs";
import { proposed } from "./_proposed.mjs";
export default proposed(current, { "templates/magic-forge.hbs": "tools/design-harness/proposed/templates/magic-forge.hbs" }, { extraCss: "tools/design-harness/proposed/css/magic-forge.css" });
