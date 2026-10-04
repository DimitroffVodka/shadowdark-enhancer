import current from "./quick-adjust.mjs";
import { proposed } from "./_proposed.mjs";
export default proposed(current, { "templates/quick-adjust.hbs": "tools/design-harness/proposed/templates/quick-adjust.hbs" }, { extraCss: "tools/design-harness/proposed/css/quick-adjust.css" });
