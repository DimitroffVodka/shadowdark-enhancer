import current from "./class-importer.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/class-importer.hbs": "tools/design-harness/proposed/templates/class-importer.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/class-importer.css", width: 720,
  strings: { "SDE.importer.ui.classSub": "Paste a class from your book, create it, then attach its roll tables." } }), compareState: "busy" };
