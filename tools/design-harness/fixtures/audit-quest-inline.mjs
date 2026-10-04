// Audit fixture: Quest Log embedded in the Party sheet's Quests tab (inline: true). GM view.
import { renderTemplate, inParty, asQuest } from "./_audit-embed.mjs";
import ql from "./audit-quest-log.mjs";
const build = () => {
  const ctx = ql.build("gm").context; ctx.inline = true; ctx.hasParties = true;
  return { ...inParty("gm.quests", { questHTML: asQuest(renderTemplate("templates/quest-log.hbs", ctx)) }), height: 650 };
};
export default { previewHeight: 700, initial: "x", build, actions: {}, title: "The Lantern Guild", icon: "fa-solid fa-users", classes: ["shadowdark", "sheet", "party", "sde-party"], resizable: true, width: 750, height: 650, template: "templates/party/party.hbs" };
