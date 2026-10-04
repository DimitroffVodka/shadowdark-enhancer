import current from "./loot-generator.mjs";
import { proposed } from "./_proposed.mjs";
export default proposed(current, { "templates/loot-generator.hbs": "tools/design-harness/proposed/templates/loot-generator.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/loot-generator.css",
  strings: { "SDE.proposed.loot.headSub": "Roll a treasure table, then post, drop or give each result.", "SDE.proposed.loot.headSubEmpty": "No loot tables are set up yet.", "SDE.proposed.loot.tables": "Tables", "SDE.proposed.loot.rolls": "Rolls", "SDE.proposed.loot.history": "History" },
});
