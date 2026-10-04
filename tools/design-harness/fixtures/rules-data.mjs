// RulesDataApp (scripts/rules-data/rules-data-app.mjs): the GM's rules tables, every table filled, a custom ruleset
// selected-able, a hex scene named, six climate regions. Context follows _prepareContext, through rules-data-core's own
// rulesFrom. 780 x 760 is the real size. The harness's selectOptions stub neither localizes nor adds the blank option,
// so the choices here are pre-localized and carry their own "—" entry.
import { readFileSync } from "node:fs";
import { rulesFrom, TERRAIN_TYPES, COSTED_TYPES, ELEVATIONS, SEASONS, HARSH, TRAVEL_METHODS, VISIBILITY_KEYS, SETTLEMENT_KINDS, TERRAIN_KEYS } from "../../../scripts/rules-data/rules-data-core.mjs";
const en = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const L = (k) => en[k] ?? k;
const choices = (keys, prefix) => ({ "": "—", ...Object.fromEntries(keys.map((k) => [k, L(prefix + k)])) });
const stored = { terrain: {}, terrainTypes: {}, travel: {}, visibility: {}, carousing: {}, recruiting: {}, climate: [] };
TERRAIN_KEYS.forEach((k, i) => { stored.terrain[k] = { type: TERRAIN_TYPES[i % 3], cost: 1 + (i % 3), boat: i % 2 ? 1 : null, elevation: k === "mountain" ? "high" : "" }; });
COSTED_TYPES.forEach((k, i) => { stored.terrainTypes[k] = 2 + i; });
TRAVEL_METHODS.forEach((k, i) => { stored.travel[k] = 3 + i * 2; });
VISIBILITY_KEYS.forEach((k, i) => { stored.visibility[k] = i + 1; });
SETTLEMENT_KINDS.forEach((k, i) => { stored.carousing[k] = i + 1; stored.recruiting[k] = i * 2; });
["Western Reaches", "Saltmarsh Coast", "The Frostfang Barrens", "Verdant Heartland", "Ashen Waste of Karrow", "Cinder Isles"].forEach((region, i) => {
  stored.climate.push({ region, spring_fall: { label: "Mild", harsh: "" }, summer: { label: i % 2 ? "Scorching and humid" : "Warm", harsh: i % 2 ? "storm" : "" }, winter: { label: "Bitterly cold", harsh: "always" } });
});
const r = rulesFrom(stored);
const flat = (table, keys, labelOf, placeholder = "") => ({ title: `SDE.rulesData.table.${table}`, hint: `SDE.rulesData.hint.${table}`, rows: keys.map((k) => ({ name: `${table}.${k}`, label: labelOf(k), value: r[table][k] ?? "", placeholder })) });
const rulesets = [{ id: "", label: L("SDE.rulesData.set.default"), selected: true }, { id: "sc", label: "Saltmarsh Coast ruleset" }];
const base = {
  previewHeight: 820, title: "SDE.rulesData.title", icon: "fa-solid fa-scroll", classes: ["shadowdark", "sde-rules-data"], width: 780, height: 760, resizable: true,
  template: "templates/rules-data.hbs",
  context: {
    rulesets, custom: false, canImport: true, sceneName: "The Western Reaches (A0 hex map)", sceneRulesets: rulesets,
    terrain: Object.entries(r.terrain).map(([key, row]) => ({ key, word: key.replace(/_/g, " "), ...row, cost: row.cost ?? "", boat: row.boat ?? "", removable: !TERRAIN_KEYS.includes(key) })),
    typeChoices: choices(TERRAIN_TYPES, "SDE.rulesData.type."), elevationChoices: choices(ELEVATIONS, "SDE.rulesData.elevation."), harshChoices: choices(HARSH, "SDE.rulesData.harsh."),
    seasons: SEASONS.map((s) => `SDE.rulesData.season.${s}`),
    climate: [...r.climate, { region: "" }].map((row, i) => ({ i, region: row.region, cells: SEASONS.map((s) => ({ season: s, label: row[s]?.label ?? "", harsh: row[s]?.harsh ?? "" })) })),
    flats: [flat("terrainTypes", COSTED_TYPES, (k) => `SDE.rulesData.type.${k}`), flat("travel", TRAVEL_METHODS, (k) => `SDE.rulesData.travel.${k}`), flat("visibility", VISIBILITY_KEYS, (k) => `SDE.rulesData.visibility.${k}`),
      flat("carousing", SETTLEMENT_KINDS, (k) => `SDE.rulesData.settlement.${k}`, L("SDE.rulesData.noLimit")), flat("recruiting", SETTLEMENT_KINDS, (k) => `SDE.rulesData.settlement.${k}`, L("SDE.rulesData.noLimit"))],
  },
};
// state "full" lifts the height so the whole scrolling body shows (the real window is 760px and scrolls).
export default { ...base, initial: "scroll", build: (state) => (state === "full" ? { height: "auto" } : {}) };
