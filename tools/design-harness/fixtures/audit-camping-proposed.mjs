// Camping standalone in the kit window frame. The current audit-camping fixture shows it inside the Party sheet,
// so this builds the same context (exported by audit-camping.mjs) and renders the proposed template on its own.
const { context } = await import(`./audit-camping.mjs?${Date.now()}`);   // not cached: a long-running server must see edits to the sample data
import { proposed } from "./_proposed.mjs";
const current = { title: "SDE.camping.title", icon: "fa-solid fa-campground", width: 640, height: 760, resizable: true, template: "templates/camping/camping.hbs", initial: "setup",
  build: (s) => ({ context: context(s.replace("-full", "")) }),
  toolbar: ["setup", "fuel", "results"].map((s) => `<button data-action="t" data-state="${s}">${s}</button>`).join(""), actions: { t: { state: "{state}" } } };
export default { ...proposed(current, { "templates/camping/camping.hbs": "tools/design-harness/proposed/templates/camping.hbs" }, { extraCss: "tools/design-harness/proposed/css/camping.css", strings: {
  "SDE.proposed.camping.rationsTip": "Ration count",
  "SDE.proposed.camping.readyBtn": "Ready", "SDE.proposed.camping.readyBtnTip": "Confirm your camp choices.",
  "SDE.proposed.camping.readyTip": "The player has confirmed their camp choices.",
  "SDE.proposed.camping.notReady": "Not ready", "SDE.proposed.camping.waitingTip": "The player has not confirmed their camp choices yet." } }), compareState: "setup" };
