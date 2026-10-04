import current from "./adventure-placer.mjs";
import { proposed } from "./_proposed.mjs";
export default { ...proposed(current, { "templates/adventure-placer.hbs": "tools/design-harness/proposed/templates/adventure-placer.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/adventure-placer.css", width: 340 }), compareState: "busy" };
