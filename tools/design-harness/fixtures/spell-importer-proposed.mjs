import current from "./spell-importer.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/spell-importer.hbs": "tools/design-harness/proposed/templates/spell-importer.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/spell-importer.css", width: 760,
  strings: { "SDE.importer.ui.spellSub": "Pick a spell list, paste the spells, check how they were sorted, then import." } }), compareState: "busy" };
