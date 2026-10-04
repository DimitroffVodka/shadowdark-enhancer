// The Monster Creator panel (templates/encounter-creator.hbs, scripts/monster-creator/encounter-creator.mjs). It is not a
// window: MonsterCreatorApp mounts it in the "Creator" tab of the Encounter Roller (templates/encounter-roller.hbs,
// 1280px wide). This fixture compiles the real creator template and sets it in the roller's own tab frame (nav, hr,
// .sde-content, .tab, #sde-monster-creator-host). The other three roller tabs are not drawn.
//   state: open    every section open, a monster loaded from a token (source banner), spells attached
//          loader  the Bestiary Loader takeover
//          closed  the first-open state: only Identity open
import { compile, windowHtml, say, esc } from "./_hb.mjs";
import { ACTION_QUICK_PICKS } from "../../../scripts/monster-creator/action-templates.mjs";
import { FEATURE_QUICK_PICKS } from "../../../scripts/monster-creator/feature-templates.mjs";
import { BASE_GUIDELINES, planLevelAdjust } from "../../../scripts/monster-creator/level-guidelines.mjs";

const art = "/systems/shadowdark/assets/tokens/cowled_token.webp";
const signed = (n) => (Number(n) < 0 ? String(n) : `+${n}`);
const draft = {
  name: "Hill Giant Chieftain of the Broken Tooth Clan", alignment: "C", level: 6, img: art, tokenSrc: "worlds/western-reaches/tokens/hill-giant-chieftain-large-token.webp",
  hp: { value: 30, max: 30 }, ac: 13, abilities: { str: 4, dex: 0, con: 3, int: -2, wis: 0, cha: -1 }, darkAdapted: true, move: "near", moveNote: "burrow",
  actions: [
    { id: "a1", name: "Greatclub", type: "NPC Attack", num: 2, bonus: 6, damage: "2d6", ranges: ["close"], description: "Hits hard enough to splinter a shield." },
    { id: "a2", name: "Hurled boulder", type: "NPC Attack", num: 1, bonus: 4, damage: "1d10", ranges: ["near", "far"], description: "" },
    { id: "a3", name: "Earth-shaking stomp", type: "NPC Feature", description: "Everything within close DC 14 DEX or knocked prone." },
  ],
  features: [{ id: "f1", name: "Thick hide", description: "Resists non-magical piercing damage." }, { id: "f2", name: "Rallying bellow", description: "Allies within near have advantage on their next attack. Once per round." }],
  spells: [], spellcasting: { ability: "wis", bonus: 3, attacks: 1 }, description: "Chieftain of the Broken Tooth. Carries a club made from a mill beam.",
};
const spellPicker = {
  search: "fire", tier: null, source: "", sourceOptions: [{ value: "", label: "All sources" }, { value: "core", label: "Core Rulebook" }, { value: "wr", label: "Western Reaches" }], tierOptions: [1, 2, 3, 4, 5], canBuildLibrary: true,
  selectedCount: 3, selected: [{ uuid: "s1", name: "Burning hands", img: art, tierLabel: "Tier 1" }, { uuid: "s2", name: "Fireball of the Seventh Lantern", img: art, tierLabel: "Tier 3" }, { uuid: "s3", name: "Wall of flame", img: art, tierLabel: "Tier 4" }],
  resultCount: 6, resultTotal: 52, capped: true,
  results: ["Burning hands", "Fireball", "Fire shield", "Flame strike", "Produce flame", "Wall of fire"].map((name, i) => ({ uuid: "r" + i, name, img: art, tierLabel: `Tier ${i % 5 + 1}`, rangeLabel: ["Close", "Near", "Far"][i % 3], sourceLabel: i % 2 ? "Western Reaches" : "Core Rulebook", added: i === 1, variant: i === 2, conflict: i === 3, warningCount: i === 4 ? 2 : 0, sourceActorUuid: i === 5 ? "Actor.x" : "" })),
};
const plan = planLevelAdjust({ level: 4, ac: 11, hp: { max: 22 }, abilities: draft.abilities, attacks: [{ id: "a1", name: "Greatclub", num: 1, bonus: 4, damage: "1d8" }, { id: "a2", name: "Hurled boulder", num: 1, bonus: 2, damage: "1d6" }] }, 6, { table: BASE_GUIDELINES });
const dec = (r, s = false) => r && { ...r, fromLabel: s ? signed(r.from) : String(r.from), toLabel: s ? signed(r.to) : String(r.to), deltaLabel: r.delta ? signed(r.delta) : "" };
const grp = (k) => plan.rows.filter((r) => r.group === k);
const ab = grp("abilities").map((r) => ({ ...dec(r, true), label: say("SDE.importer.abil." + r.key.split(".")[1]) }));
const baseline = { effectiveLevel: 6, writtenLevel: 4, hasSpellBump: true, spellReasons: ["Casts 3 spells", "Has a tier-3 damage spell"], changed: plan.changed, apply: { ac: true, hp: true, abilities: true, attacks: true }, rows: { ac: dec(grp("ac")[0]), hp: dec(grp("hp")[0]), abilities: ab }, abilitiesChanged: ab.some((r) => r.changed), attacks: plan.attacks, hasAttacks: true, attacksChanged: true };
const mutations = {
  selectedCount: 2, staleCount: 1,
  sets: [
    { key: "gen", label: "Monster Generator", state: "ready", stateLabel: "Ready", ready: true, columns: [["Feature", "m1"], ["Attack", "m2"], ["Weakness", "m3"]].map(([columnLabel, manifestId]) => ({ columnLabel, manifestId, tableUuid: "t" + manifestId, results: [{ resultId: "r1", text: "Screams for help while burning", selected: manifestId === "m1" }, { resultId: "r2", text: "Splits into two smaller copies when struck by lightning", selected: false }] })) },
    { key: "weird", label: "Make It Weird", state: "locked", stateLabel: "Locked", ready: false, label2: "", diagnostics: [{ code: "missing", message: "Make It Weird d12 table 2 is not imported." }] },
  ],
  selection: [{ setLabel: "Generator", columnLabel: "Feature", mode: "automated", modeLabel: "Automated", text: "Screams for help while burning", manifestId: "m1" }, { setLabel: "Generator", columnLabel: "Weakness", mode: "gm", modeLabel: "GM adjudicated", text: "Splits into two smaller copies when struck by lightning", manifestId: "m3" }],
  applied: { total: 2, automated: 1, mixed: 0, gm: 1, generatorCount: 2, mutationsCount: 0, applications: [{ mode: "automated", modeLabel: "Automated", edited: true, conflict: false, setLabel: "Generator", columnLabel: "Feature", chips: [{ label: "+2 AC" }, { label: "Aura" }] }] },
};
const source = { name: "Hill Giant Chieftain", editingHtml: say("SDE.encounterCreator.source.editing", { name: "<b>Hill Giant Chieftain</b>", scope: '<span class="sde-creator-source-scope">(this token only)</span>' }) };
const loaderRows = Array.from({ length: 14 }, (_, i) => ({ uuid: "u" + i, img: art, name: ["Giant spider", "Ogre of the Salt Marsh", "Hill giant", "Skeleton warrior", "Gnoll packlord", "Wraith", "Cave troll", "Basilisk", "Dire wolf", "Cultist of the Pale Lantern", "Ankheg", "Owlbear", "Stone golem", "Young green dragon"][i], levelLabel: String(i + 1), alignment: "NC"[i % 2] ?? "N", alignmentLabel: "Neutral", hpLabel: String(8 + i * 5), acLabel: String(10 + (i % 6)), dprLabel: (3 + i * 1.5).toFixed(1), attackCount: 2, attackSummary: "2 atk", primaryAttack: "bite", attackKinds: { melee: true, ranged: i % 3 === 0, special: i % 4 === 0 }, hasSpellcasting: i % 5 === 0, spellcastingBonus: 3, darkAdapted: i % 2 === 0 }));
const loaderData = { availableSources: [{ id: "core", label: "Core Rulebook" }, { id: "wr", label: "Western Reaches" }, { id: "cs", label: "Cursed Scroll 1" }], selectedSources: ["core", "wr"], sourcesLabel: "2 sources", rows: loaderRows, totalCount: 244, filteredCount: 14, empty: false, noSources: false, search: "", alignment: ["C"], levelMin: 2, levelMax: 8, hpMin: null, hpMax: null, acMin: null, acMax: null, moves: [], moveOptions: ["close", "near", "far", "fly"], darkAdapted: false, hasSpellcasting: false, abilitySearch: "", sortCol: "name", sortAsc: true };
const open = { identity: true, stats: true, movement: true, actions: true, features: true, spellcasting: true, mutations: true, baseline: true, description: true };
export const contextFor = (state) => {
  const loader = state === "loader", closed = state === "closed";
  return {
    draft: closed ? { ...draft, name: "", level: 0, actions: [], features: [], spellcasting: {}, description: "", move: "close", moveNote: "", darkAdapted: false, abilities: {}, hp: { value: 1, max: 1 }, ac: 10 } : draft,
    levelStep: { atMin: false, atMax: false, max: 30 }, source: state === "open" ? source : null,
    draftPreview: "Hill Giant Chieftain of the Broken Tooth Clan, LV 6 C. AC 13, HP 30, ATK 2 greatclub +6 (2d6), 1 hurled boulder +4 (1d10), MV near (burrow).",
    sectionOpen: closed ? { identity: true } : open, spellPicker: closed ? { ...spellPicker, selectedCount: 0, selected: [], resultCount: 0, results: [], capped: false } : spellPicker,
    mutations: closed ? { selectedCount: 0, staleCount: 0, sets: mutations.sets, selection: [], applied: { total: 0 } } : mutations, baseline,
    alignments: ["L", "N", "C"], abilityFields: ["str", "dex", "con", "int", "wis", "cha"].map((key) => ({ key, label: key.toUpperCase() })),
    moveOptions: ["none", "close", "near", "doubleNear", "tripleNear", "far", "special"], spellAbilities: ["int", "wis", "cha"], ACTION_QUICK_PICKS, ranges: ["close", "near", "far", "nearLine"], FEATURE_QUICK_PICKS,
    _loaderOpen: loader, loaderData: loader ? loaderData : null,
  };
};
const build = (state) => {
  const ctx = contextFor(state);
  const creator = compile("templates/encounter-creator.hbs", ctx);
  const tab = (id, icon, label, on) => `<button type="button" class="item ${on ? "active" : ""}" data-tab="${id}" aria-pressed="${on}"><i class="fas ${icon}"></i> ${esc(say(label))}</button>`;
  const body = `<div class="sde-encounter-roller"><nav class="sde-tabs" data-group="primary">${tab("tables", "fa-table-list", "SDE.encounter.roller.tab.tables", false)}${tab("build", "fa-hammer", "SDE.encounter.roller.tab.build", false)}${tab("browse", "fa-user-group", "SDE.encounter.roller.tab.browse", false)}${tab("creator", "fa-wand-magic-sparkles", "SDE.encounter.roller.tab.creator", true)}</nav><hr><section class="sde-content"><div class="tab active" data-tab="creator"><div id="sde-monster-creator-host">${creator}</div></div></section></div>`;
  return { html: windowHtml("sde-encounter-roller", { title: say("SDE.encounter.roller.title"), icon: "fas fa-dice-d20", tag: "form" }, body) };
};
export default {
  previewHeight: 900, title: "Encounter Roller", width: 1280, initial: "open", build,
  toolbar: `<span>State:</span>${["open", "loader", "closed"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`, actions: { s: { state: "{state}" } },
};
