import current from "./item-builder.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/item-builder.hbs": "tools/design-harness/proposed/templates/item-builder.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/item-builder.css", width: 760,
  strings: { "SDE.importer.ui.itemSub": "Paste a price table and the descriptions, match them up, then create the items." } }), compareState: "busy" };
