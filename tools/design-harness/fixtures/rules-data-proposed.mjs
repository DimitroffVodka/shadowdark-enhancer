import current from "./rules-data.mjs";
import { proposed } from "./_proposed.mjs";
export default proposed(current, { "templates/rules-data.hbs": "tools/design-harness/proposed/templates/rules-data.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/rules-data.css",
});
