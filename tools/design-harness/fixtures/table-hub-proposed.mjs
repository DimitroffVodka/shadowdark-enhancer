import current from "./table-hub.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/table-hub.hbs": "tools/design-harness/proposed/templates/table-hub.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/table-hub.css", width: 820,
  strings: { "SDE.importer.ui.tableSub": "See which roll tables are in the system, imported or still missing, and import the rest." } }), compareState: "dashboard" };
