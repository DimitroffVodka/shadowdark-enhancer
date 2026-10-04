import current from "./crawl-tracker.mjs";
import { proposed } from "./_proposed.mjs";
// The tracker keeps core's combat-sidebar classes and markup on purpose; only a small stylesheet is added.
const p = proposed(current, {}, { classes: current.classes, extraCss: "tools/design-harness/proposed/css/crawl-tracker.css" });
const css = p.css.slice(p.css.indexOf(".sde-ui {") >= 0 ? 0 : 0);
const build = p.build;
export default { ...p, css: p.css.replace(/^[\s\S]*?(?=\/\* Crawl order tab)/, ""), build: (s) => ({ ...build(s), classes: p.classes, css: p.css.replace(/^[\s\S]*?(?=\/\* Crawl order tab)/, "") }) };
