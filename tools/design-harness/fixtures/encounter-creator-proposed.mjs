// Proposed kit version of the Monster Creator panel, set in the Encounter Roller window as the current fixture does.
// state: open (default; the Actions tab open, a token-loaded monster) | spells | mutator | baseline | closed | loader
import { compile, windowHtml, say, esc } from "./_hb.mjs";
import { contextFor } from "./encounter-creator.mjs";
import { UI_CSS } from "./_proposed.mjs";
import fs from "node:fs";

const css = UI_CSS() + "\n" + fs.readFileSync(new URL("../proposed/css/encounter-creator.css", import.meta.url), "utf8");
const one = (k) => Object.fromEntries(["actions", "features", "spellcasting", "mutations", "baseline", "identity", "stats", "movement", "description"].map((s) => [s, s === k]));
const build = (state) => {
  const ctx = contextFor(["spells", "mutator", "baseline", "open"].includes(state) ? "open" : state);
  const loader = state === "loader", closed = state === "closed";
  const tab = { open: "actions", spells: "spellcasting", mutator: "mutations", baseline: "baseline", closed: "none" }[state];
  const c = { ...ctx, _loaderOpen: loader, loaderData: loader ? ctx.loaderData : null, sectionOpen: one(tab) };
  const creator = compile("tools/design-harness/proposed/templates/encounter-creator.hbs", c);
  return { html: windowHtml("sde-encounter-roller", { title: say("SDE.encounter.roller.title"), icon: "fas fa-dice-d20", tag: "form", classes: "sde-ui" }, `<div class="ui-shell mc-host" id="sde-monster-creator-host">${creator}</div>`) };
};
export default { previewHeight: 760, title: "Encounter Roller", width: 1280, initial: "open", css, build,
  toolbar: `<span>State:</span>${["open", "spells", "mutator", "baseline", "closed", "loader"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`, actions: { s: { state: "{state}" } } };
