import current from "./audit-session-recap.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/session-recap.hbs": "tools/design-harness/proposed/templates/session-recap.hbs" }, { extraCss: "tools/design-harness/proposed/css/session-recap.css", classes: ["sde-ui"] }), compareState: "overview" };
