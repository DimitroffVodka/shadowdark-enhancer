import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { EMBLEM_ICONS, EMBLEM_COLORS, EMBLEM_ICON_KEYS, EMBLEM_COLOR_KEYS, DEFAULT_EMBLEM, emblemOf, emblemIconPath, emblemChoices, pickEmblem } from "../scripts/party/party-emblem-core.mjs";

test("a party that chose nothing wears the lantern in amber", () => {
  assert.deepEqual(DEFAULT_EMBLEM, { icon: "lantern", color: "c8892b" });
  for (const none of [undefined, null, {}, "x", 7, []]) assert.deepEqual(emblemOf(none), DEFAULT_EMBLEM);
});

test("a stored emblem is kept, case and # tolerated, and junk falls back half by half", () => {
  assert.deepEqual(emblemOf({ icon: "wolf-head", color: "3a6ea5" }), { icon: "wolf-head", color: "3a6ea5" });
  assert.deepEqual(emblemOf({ icon: "wolf-head", color: "#3A6EA5" }), { icon: "wolf-head", color: "3a6ea5" });
  assert.deepEqual(emblemOf({ icon: "../../etc/passwd", color: "3a6ea5" }), { icon: "lantern", color: "3a6ea5" }, "an icon outside the set is never used as a path");
  assert.deepEqual(emblemOf({ icon: "owl", color: "blue" }), { icon: "owl", color: "c8892b" });
  assert.deepEqual(emblemOf({ icon: "owl", color: "red;background:url(x)" }), { icon: "owl", color: "c8892b" }, "the colour goes into a style attribute");
});

test("the picker offers 24 icons and 8 colours, every icon is vendored, and a pick changes one half", () => {
  assert.equal(EMBLEM_ICONS.length, 24);
  assert.equal(new Set(EMBLEM_ICONS).size, 24);
  assert.equal(EMBLEM_COLORS.length, 8);
  for (const icon of EMBLEM_ICONS) assert.ok(existsSync(new URL(`../${emblemIconPath(icon)}`.replace("modules/shadowdark-enhancer/", ""), import.meta.url)), icon);
  const choices = emblemChoices({ icon: "owl", color: "b33a3a" });
  assert.deepEqual(choices.icons.filter((i) => i.selected).map((i) => i.name), ["owl"]);
  assert.deepEqual(choices.colors.filter((c) => c.selected).map((c) => c.color), ["b33a3a"]);
  assert.deepEqual(pickEmblem({ icon: "owl", color: "b33a3a" }, { icon: "raven" }), { icon: "raven", color: "b33a3a" });
  assert.deepEqual(pickEmblem({ icon: "owl", color: "b33a3a" }, { color: "3f7a3f" }), { icon: "owl", color: "3f7a3f" });
  assert.deepEqual(pickEmblem(undefined, { icon: "raven" }), { icon: "raven", color: "c8892b" });
  assert.deepEqual(pickEmblem({ icon: "owl", color: "b33a3a" }, { icon: "nope", color: "123456" }), { icon: "owl", color: "b33a3a" }, "only the offered icons and colours can be picked");
});

test("every icon and colour has a name in en.json", async () => {
  const en = JSON.parse(await readFile(new URL("../languages/en.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(EMBLEM_ICON_KEYS), EMBLEM_ICONS);
  assert.deepEqual(Object.keys(EMBLEM_COLOR_KEYS), EMBLEM_COLORS);
  for (const key of [...Object.values(EMBLEM_ICON_KEYS), ...Object.values(EMBLEM_COLOR_KEYS)]) assert.ok(en[key], key);
  const choices = emblemChoices(DEFAULT_EMBLEM, (key) => en[key]);
  assert.deepEqual(choices.icons.slice(0, 2).map((i) => i.label), ["Lantern", "Campfire"]);
  assert.equal(choices.colors[0].label, "Amber");
});

test("every vendored emblem icon is credited to its artist in CREDITS.md", async () => {
  const credits = await readFile(new URL("../CREDITS.md", import.meta.url), "utf8");
  const section = credits.slice(credits.indexOf("## Party emblem icons"));
  assert.ok(section.startsWith("## Party emblem icons"));
  for (const icon of EMBLEM_ICONS) assert.ok(section.includes(`\`${icon}.svg\``), icon);
  for (const artist of ["Lorc", "Delapouite", "DarkZaitzev"]) assert.ok(section.includes(artist), artist);
  assert.ok(section.includes("CC BY 3.0"));
});
