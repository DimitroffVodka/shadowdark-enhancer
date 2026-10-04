import current from "./hex-explorer.mjs";
import { proposed } from "./_proposed.mjs";
export default proposed(current, { "templates/hex-map/hex-explorer.hbs": "tools/design-harness/proposed/templates/hex-explorer.hbs" }, { extraCss: "tools/design-harness/proposed/css/hex-explorer.css" });
