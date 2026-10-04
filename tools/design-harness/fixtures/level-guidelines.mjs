// LevelGuidelinesEditor (scripts/monster-creator/level-guidelines-app.mjs): the real shipped table, every level, built
// with the app's own row mapping. 720 x 700 is the window's real size. Note: the window is a form, the harness frame is not.
import { BASE_GUIDELINES } from "../../../scripts/monster-creator/level-guidelines.mjs";
const rows = Object.keys(BASE_GUIDELINES).map(Number).filter(Number.isFinite).sort((a, b) => a - b).map((level) => {
  const row = BASE_GUIDELINES[String(level)];
  return { level, ac: row.ac, hp: row.hp, num: row.atk?.num ?? 1, bonus: row.atk?.bonus ?? 0, damage: row.atk?.damage ?? "1d6",
    median: row.statMod?.median ?? 0, low: row.statMod?.low ?? 0, high: row.statMod?.high ?? 0, talentDC: row.talentDC ?? 12 };
});
export default {
  previewHeight: 760, title: "SDE.settings.levelGuidelines.title", icon: "fa-solid fa-scale-balanced", classes: ["shadowdark", "sde-level-guidelines"],
  width: 720, height: 700, resizable: true, template: "templates/level-guidelines.hbs", context: { rows },
};
