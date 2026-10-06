import current from "./loot-setup.mjs";
import { proposed } from "./_proposed.mjs";
export default proposed(current, { "templates/loot-setup.hbs": "tools/design-harness/proposed/templates/loot-setup.hbs" }, { extraCss: "tools/design-harness/proposed/css/loot-setup.css" });
