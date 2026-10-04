import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { EMBLEM_ICONS, EMBLEM_COLORS, EMBLEM_ICON_COLORS, EMBLEM_ICON_KEYS, EMBLEM_COLOR_KEYS, DEFAULT_EMBLEM, emblemOf, emblemIconPath, emblemChoices, pickEmblem } from "../scripts/party/party-emblem-core.mjs";

test("a party that chose nothing wears the lantern in white on amber", () => {
  assert.deepEqual(DEFAULT_EMBLEM, { icon: "lantern", color: "c8892b", iconColor: "ffffff" });
  for (const none of [undefined, null, {}, "x", 7, []]) assert.deepEqual(emblemOf(none), DEFAULT_EMBLEM);
});

test("a stored emblem is kept, case and # tolerated, and junk falls back part by part", () => {
  assert.deepEqual(emblemOf({ icon: "wolf-head", color: "3a6ea5" }), { icon: "wolf-head", color: "3a6ea5", iconColor: "ffffff" }, "a flag from before iconColor existed reads as a white icon");
  assert.deepEqual(emblemOf({ icon: "wolf-head", color: "#3A6EA5", iconColor: "#000000" }), { icon: "wolf-head", color: "3a6ea5", iconColor: "000000" });
  assert.deepEqual(emblemOf({ icon: "../../etc/passwd", color: "3a6ea5" }), { icon: "lantern", color: "3a6ea5", iconColor: "ffffff" }, "an icon outside the set is never used as a path");
  assert.deepEqual(emblemOf({ icon: "owl", color: "blue", iconColor: "red" }), { icon: "owl", color: "c8892b", iconColor: "ffffff" });
  assert.deepEqual(emblemOf({ icon: "owl", color: "red;background:url(x)", iconColor: "fff;x" }), { icon: "owl", color: "c8892b", iconColor: "ffffff" }, "the colours go into a style attribute");
});

test("any six-digit hex is a valid tile and icon colour, not only the presets", () => {
  assert.deepEqual(emblemOf({ icon: "owl", color: "12a4b8", iconColor: "E0A040" }), { icon: "owl", color: "12a4b8", iconColor: "e0a040" });
  assert.equal(emblemOf({ icon: "owl", color: "12a4b" }).color, "c8892b", "five digits is not a colour");
  assert.equal(emblemOf({ icon: "owl", color: "12a4b8f" }).color, "c8892b", "seven digits is not a colour");
});

test("the picker offers 24 icons, 8 tile colours and 8 icon colours, every icon is vendored, and a pick changes one part", () => {
  assert.equal(EMBLEM_ICONS.length, 24);
  assert.equal(new Set(EMBLEM_ICONS).size, 24);
  assert.equal(EMBLEM_COLORS.length, 8);
  assert.equal(EMBLEM_ICON_COLORS.length, 8);
  assert.deepEqual(EMBLEM_ICON_COLORS.slice(0, 2), ["ffffff", "000000"]);
  for (const icon of EMBLEM_ICONS) assert.ok(existsSync(new URL(`../${emblemIconPath(icon)}`.replace("modules/shadowdark-enhancer/", ""), import.meta.url)), icon);
  const owl = { icon: "owl", color: "b33a3a", iconColor: "ffffff" };
  const choices = emblemChoices(owl);
  assert.deepEqual(choices.icons.filter((i) => i.selected).map((i) => i.name), ["owl"]);
  assert.deepEqual(choices.colors.filter((c) => c.selected).map((c) => c.color), ["b33a3a"]);
  assert.deepEqual(choices.iconColors.filter((c) => c.selected).map((c) => c.color), ["ffffff"]);
  assert.deepEqual([choices.customBox, choices.customIcon], [false, false]);
  assert.deepEqual(pickEmblem(owl, { icon: "raven" }), { ...owl, icon: "raven" });
  assert.deepEqual(pickEmblem(owl, { color: "3f7a3f" }), { ...owl, color: "3f7a3f" });
  assert.deepEqual(pickEmblem(owl, { iconColor: "000000" }), { ...owl, iconColor: "000000" });
  assert.deepEqual(pickEmblem(undefined, { icon: "raven" }), { icon: "raven", color: "c8892b", iconColor: "ffffff" });
  assert.deepEqual(pickEmblem(owl, { icon: "nope", color: "blue", iconColor: "#12" }), owl, "an unknown icon or a non-hex colour changes nothing");
});

test("a custom colour is picked from any hex, kept without migration, and the picker marks it custom", () => {
  const owl = { icon: "owl", color: "b33a3a", iconColor: "ffffff" };
  assert.deepEqual(pickEmblem(owl, { color: "#12A4B8" }), { ...owl, color: "12a4b8" });
  assert.deepEqual(pickEmblem(owl, { iconColor: "e0a040" }), { ...owl, iconColor: "e0a040" });
  assert.deepEqual(pickEmblem({ icon: "owl", color: "b33a3a" }, { color: "3f7a3f" }), { icon: "owl", color: "3f7a3f", iconColor: "ffffff" }, "an old preset-only flag is picked on as before");
  const custom = emblemChoices({ icon: "owl", color: "12a4b8", iconColor: "e0a040" });
  assert.deepEqual([custom.customBox, custom.customIcon], [true, true]);
  assert.equal(custom.colors.some((c) => c.selected) || custom.iconColors.some((c) => c.selected), false);
});

test("every icon and colour has a name in en.json", async () => {
  const en = JSON.parse(await readFile(new URL("../languages/en.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(EMBLEM_ICON_KEYS), EMBLEM_ICONS);
  assert.deepEqual(Object.keys(EMBLEM_COLOR_KEYS), EMBLEM_COLORS);
  for (const key of [...Object.values(EMBLEM_ICON_KEYS), ...Object.values(EMBLEM_COLOR_KEYS), "SDE.party.emblem.color.white", "SDE.party.emblem.color.black"]) assert.ok(en[key], key);
  const choices = emblemChoices(DEFAULT_EMBLEM, (key) => en[key]);
  assert.deepEqual(choices.icons.slice(0, 2).map((i) => i.label), ["Lantern", "Campfire"]);
  assert.equal(choices.colors[0].label, "Amber");
  assert.deepEqual(choices.iconColors.slice(0, 2).map((c) => c.label), ["White", "Black"]);
});

test("every vendored emblem icon is credited to its artist in CREDITS.md", async () => {
  const credits = await readFile(new URL("../CREDITS.md", import.meta.url), "utf8");
  const section = credits.slice(credits.indexOf("## Party emblem icons"));
  assert.ok(section.startsWith("## Party emblem icons"));
  for (const icon of EMBLEM_ICONS) assert.ok(section.includes(`\`${icon}.svg\``), icon);
  for (const artist of ["Lorc", "Delapouite", "DarkZaitzev"]) assert.ok(section.includes(artist), artist);
  assert.ok(section.includes("CC BY 3.0"));
});
