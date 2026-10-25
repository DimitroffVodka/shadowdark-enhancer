import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SETTING_GROUPS, GROUPED_SETTING_KEYS, entryKey, modeSwitchState } from "../scripts/shared/setting-groups.mjs";

const modes = SETTING_GROUPS.find((g) => g.key === "modesOfPlayMenu");
const settingsSrc = readFileSync(new URL("../scripts/shared/settings.mjs", import.meta.url), "utf8");

/** The object literal registered for a key in settings.mjs. */
function registration(key) {
  const at = settingsSrc.indexOf(`game.settings.register(MODULE_ID, "${key}", {`);
  assert.notEqual(at, -1, `${key} is registered`);
  return settingsSrc.slice(at, settingsSrc.indexOf("});", at));
}

test("a mode's switch is on only when every rule is on", () => {
  assert.equal(modeSwitchState([true, true]), "on");
  assert.equal(modeSwitchState([true, false]), "mixed");
  assert.equal(modeSwitchState([false, false]), "off");
  assert.equal(modeSwitchState([true]), "on");
  assert.equal(modeSwitchState([]), "off", "a mode whose rules all belong to a missing package");
});

test("every mode is its own box, and every rule of this module is its own setting", () => {
  assert.ok(modes, "the Modes of Play group exists");
  const labels = modes.sections.map((s) => s.label.split(".").pop());
  assert.deepEqual(labels, ["blitz", "chaos", "deadly", "fatality", "grinder", "hunter", "momentum", "pulp", "hardLuck"]);
  for (const s of modes.sections) assert.equal(s.mode, true, `${s.label} gets a mode switch`);
  const own = modes.sections.flatMap((s) => s.entries.map(entryKey).filter(Boolean));
  assert.equal(new Set(own).size, own.length, "no rule is listed twice");
  // A value that only means something while its rule is on (how many hit dice Grinder rolls) is not a rule.
  const VALUES = ["modeGrinderHitDice"];
  for (const key of own) {
    const body = registration(key);
    assert.match(body, /scope:\s*"world"/, `${key} is a world setting`);
    assert.match(body, /config:\s*false/, `${key} renders in the window, not the main list`);
    if (VALUES.includes(key)) continue;
    assert.match(body, /type:\s*Boolean/, `${key} is a checkbox`);
    assert.match(body, /default:\s*false/, `${key} is off until a GM opts in`);
  }
  assert.match(registration("modeGrinderHitDice"), /type:\s*Number[\s\S]*min:\s*1,\s*max:\s*4[\s\S]*default:\s*1/);
});

test("the natural-1 rule moved to Hard Luck, same key, now off by default", () => {
  const hardLuck = modes.sections.find((s) => s.label.endsWith(".hardLuck"));
  assert.ok(hardLuck.entries.map(entryKey).includes("luckRerollPreventNat1"));
  const pc = SETTING_GROUPS.find((g) => g.key === "pcAutomationMenu");
  assert.ok(!pc.sections.some((s) => s.entries.map(entryKey).includes("luckRerollPreventNat1")), "not in two windows");
  assert.equal(GROUPED_SETTING_KEYS.filter((k) => k === "luckRerollPreventNat1").length, 1);
  assert.match(registration("luckRerollPreventNat1"), /default:\s*false/);
});

test("the system's own settings render in place and stay theirs", () => {
  const foreign = modes.sections.flatMap((s) => s.entries.filter((e) => e?.setting).map((e) => e.setting));
  assert.deepEqual(foreign, ["shadowdark.useMomentumMode", "shadowdark.usePulpMode"]);
  for (const key of foreign) assert.ok(!GROUPED_SETTING_KEYS.includes(key), `${key} is not registered by this module`);
  for (const key of foreign) {
    const entry = modes.sections.flatMap((s) => s.entries).find((e) => e?.setting === key);
    assert.ok(entry.missing, `${key} says so when the installed system lacks it`);
  }
});

test("Grinder is the Enhancer's own: hit dice and the CON option follow its switch", () => {
  const grinder = modes.sections.find((s) => s.label.endsWith(".grinder"));
  assert.deepEqual(grinder.entries.map(entryKey), ["modeGrinder", "modeGrinderHitDice", "modeGrinderOverflowCon"]);
  assert.ok(!grinder.entries.some((e) => e?.setting), "nothing in it is another package's setting");
  assert.equal(grinder.entries[1].showIf, "shadowdark-enhancer.modeGrinder");
  assert.equal(grinder.entries[2].showIf, "shadowdark-enhancer.modeGrinder");
  assert.equal(grinder.entries[2].option, true, "the CON option is not part of what the Grinder switch flips");
  assert.match(registration("modeGrinderOverflowCon"), /default:\s*false/);
});
