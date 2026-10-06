// Token Art Manager, proposed. States: monsters | sources (tab derived from the state).
import current from "./token-art-manager.mjs";
import { proposed } from "./_proposed.mjs";
const base = proposed(current, { "templates/token-art-manager.hbs": "tools/design-harness/proposed/templates/token-art-manager.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/token-art-manager.css", width: 720,
  strings: { "SDE.importer.ui.tamSub": "Choose which installed art skins each monster, then apply." } });
export default { ...base, initial: "monsters", compareState: "monsters",
  build: (s) => { const r = base.build(s); return { ...r, context: { ...r.context, tab: s === "sources" ? "sources" : "monsters" }, toolbar: ["monsters", "sources"].map((x) => `<a href="?state=${x}" style="color:#9cf">${x}</a>`).join(" | ") }; },
  actions: { tamTab: { state: "{tab}" } } };
