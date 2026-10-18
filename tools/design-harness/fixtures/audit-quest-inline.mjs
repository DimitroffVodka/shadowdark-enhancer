// Audit fixture: Quest Log embedded in the Party sheet's Quests tab (inline: true). GM view.
import { renderTemplate, inParty, asQuest } from "./_audit-embed.mjs";
import ql from "./audit-quest-log.mjs";
const build = (state = "gm") => {
  const player = state === "player";
  const ctx = ql.build(player ? "playeravail" : "gm").context; ctx.inline = true; ctx.hasParties = true;
  return { ...inParty(`${player ? "player" : "gm"}.quests`, { questHTML: asQuest(renderTemplate("templates/quest-log.hbs", ctx)) }), height: 2100 };
};
export default { previewHeight: 2200, initial: "gm", build, toolbar: `<button data-action="v" data-state="gm">GM</button><button data-action="v" data-state="player">player (Available)</button>`, actions: { v: { state: "{state}" } }, title: "The Lantern Guild", icon: "fa-solid fa-users", classes: ["shadowdark", "sheet", "party", "sde-party"], resizable: true, width: 750, height: 2100, template: "templates/party/party.hbs" };
