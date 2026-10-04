import current from "./hex-tagger.mjs";
import { proposed } from "./_proposed.mjs";
const p = proposed(current, { "templates/hex-tagger.hbs": "tools/design-harness/proposed/templates/hex-tagger.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/hex-tagger.css",
  strings: { "SDE.hexMap.tab.sheet": "Sheet", "SDE.hexMap.tab.map": "Map", "SDE.hexMap.tab.terrains": "Terrains", "SDE.hexMap.tab.data": "Data", "SDE.hexMap.tab.settings": "Settings" },   // new strings, until they are in languages/en.json
});
// The tabs are CSS-only. state = sheet (default) | map | terrains | data | settings shows that tab's panel (a harness override of the radios).
const tabs = { sheet: 1, map: 2, terrains: 3, data: 4, settings: 5 };
const show = (s) => (tabs[s] && tabs[s] !== 1 ? `.hxt-p1{display:none!important}.hxt-p${tabs[s]}{display:flex!important}.hxt-foot{display:none!important}` : ".hxt-foot{display:flex!important}");
// the current fixture's build() returns the whole window (classes included), which would put the old classes back
const build = p.build;
export default { ...p, initial: "sheet", build: (s) => ({ ...build(tabs[s] ? "more" : s), classes: p.classes, css: p.css + show(s), strings: p.strings }),
  toolbar: Object.keys(tabs).map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join(""), actions: { s: { state: "{state}" } } };
