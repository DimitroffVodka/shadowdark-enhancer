// QuickAdjustApp (scripts/monster-creator/quick-adjust-app.mjs): the token HUD re-level panel, context built the way
// _prepareContext builds it from the real planLevelAdjust, for a level-3 monster sent to level 9 with three attacks, the
// spell-bump notice, a backup to revert to. 460px wide, height auto. State "same" = target equals the current level.
import { BASE_GUIDELINES, guidelineFor, planLevelAdjust } from "../../../scripts/monster-creator/level-guidelines.mjs";
import { readFileSync } from "node:fs";
import { ABILITY_LABEL_KEYS } from "../../../scripts/monster-creator/level-guidelines.mjs";
const en = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const signed = (n) => (Number(n) < 0 ? String(n) : `+${n}`);
const snapshot = {
  level: 3, ac: 11, hp: { value: 14, max: 22 }, abilities: { str: 3, dex: 0, con: 2, int: -2, wis: 0, cha: -1 },
  attacks: [{ id: "a", name: "Greatclub", num: 1, bonus: 4, damage: "1d8" }, { id: "b", name: "Hurled boulder (far)", num: 1, bonus: 2, damage: "1d6" }, { id: "c", name: "Trample", num: 1, bonus: 3, damage: "2d4" }],
};
const build = (state) => {
  const target = state === "same" ? 3 : 9;
  const plan = planLevelAdjust(snapshot, target, { table: BASE_GUIDELINES });
  const decorate = (row, s = false) => row && { ...row, fromLabel: s ? signed(row.from) : String(row.from), toLabel: s ? signed(row.to) : String(row.to), deltaLabel: row.delta === 0 ? "" : signed(row.delta) };
  const group = (key) => plan.rows.filter((r) => r.group === key);
  const abilities = group("abilities").map((r) => ({ ...decorate(r, true), label: en[ABILITY_LABEL_KEYS[r.key.split(".")[1]]] ?? r.label })); // the app localizes these; the harness has no i18n for planLevelAdjust
  return { context: {
    actorName: "Hill Giant Chieftain of the Broken Tooth Clan", img: "/systems/shadowdark/assets/tokens/cowled_token.webp", currentLevel: 3, targetLevel: target, maxLevel: 30,
    atMinLevel: false, atMaxLevel: false, levelChanged: target !== 3, apply: { ac: true, hp: true, abilities: true, attacks: true }, guideline: guidelineFor(target, BASE_GUIDELINES),
    rows: { ac: decorate(group("ac")[0]), hp: decorate(group("hp")[0]), abilities }, abilitiesChanged: abilities.some((r) => r.changed),
    attacks: plan.attacks, hasAttacks: true, attacksChanged: plan.attacks.some((a) => a.changed), changed: plan.changed, hasBackup: true,
    spellBump: 2, spellReasons: ["Casts 2 tier-3 spells", "Has a spell that deals damage over time"], spellLevel: 5,
  }, title: "Adjust Hill Giant Chieftain of the Broken Tooth Clan" };
};
export default {
  previewHeight: 640, title: "Adjust Hill Giant Chieftain of the Broken Tooth Clan", icon: "fa-solid fa-scale-balanced", classes: ["shadowdark", "sde-quick-adjust"],
  width: 460, resizable: true, template: "templates/quick-adjust.hbs", initial: "up", build,
  toolbar: `<span>State:</span><button data-action="s" data-state="up">level 9</button><button data-action="s" data-state="same">no change</button>`, actions: { s: { state: "{state}" } },
};
