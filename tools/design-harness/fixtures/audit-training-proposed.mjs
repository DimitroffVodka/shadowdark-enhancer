import current from "./audit-training.mjs";
import { proposed } from "./_proposed.mjs";
export default proposed(current, { "templates/training.hbs": "tools/design-harness/proposed/templates/training.hbs" }, { extraCss: "tools/design-harness/proposed/css/training.css" });
