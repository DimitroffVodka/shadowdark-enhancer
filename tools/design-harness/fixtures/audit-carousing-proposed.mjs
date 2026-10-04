// Carousing standalone, shared-tier rule. Builds the audit context, then moves tier and cost to the top level (the new context shape).
import { context } from "./audit-carousing.mjs";
import { proposed } from "./_proposed.mjs";
const tiers = [["Wealthy", 50, 3], ["Comfortable", 20, 1], ["Poor", 5, 0]];
const shared = (s) => {
  const c = context(s), pick = 1, [name, cost, bonus] = tiers[pick];
  const count = c.rows.filter((r) => r.participate).length;
  c.rows = c.rows.map(({ tiers: _t, garbQuestions: _g, ...r }) => r);
  return { ...c, tiers: tiers.map(([n, g, b], k) => ({ id: "t" + k, label: `${n} - ${g} gp, bonus +${b}`, selected: k === pick })), tier: { description: name, cost, bonus }, cost, count, share: Math.round((cost / count) * 100) / 100 };
};
const current = { title: "SDE.carousing.title", icon: "fa-solid fa-beer-mug-empty", width: 640, height: 760, resizable: true, template: "templates/carousing/carousing.hbs", initial: "setup",
  build: (s) => ({ context: shared(s.replace("-full", "")) }),
  toolbar: ["setup", "complete"].map((s) => `<button data-action="t" data-state="${s}">${s}</button>`).join(""), actions: { t: { state: "{state}" } } };
export default { ...proposed(current, { "templates/carousing/carousing.hbs": "tools/design-harness/proposed/templates/carousing.hbs" }, { extraCss: "tools/design-harness/proposed/css/carousing.css", strings: {
  "SDE.carousing.sharedRule": "Everyone who joins takes the same tier, and the cost is shared between them.",
  "SDE.carousing.join": "Joining", "SDE.carousing.partyTier": "Tier (same for everyone)", "SDE.carousing.rollBonus": "Roll bonus", "SDE.carousing.sharedCost": "Shared cost", "SDE.carousing.eachPays": "Each of {n} pays" } }), compareState: "setup" };
