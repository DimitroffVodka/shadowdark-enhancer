import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TRAINERS,
  benefitFor,
  isMechanical,
  remainingRolls,
  resolveRoll,
  trainerByKey,
  trainersByRegion,
} from "../scripts/training/training-core.mjs";

describe("regional training — the shipped trainers", () => {
  it("is the book's twenty-one trainers, four benefits each", () => {
    assert.equal(TRAINERS.length, 21);
    for (const t of TRAINERS) {
      assert.equal(t.benefits.length, 4, `${t.key} should print four benefits`);
      assert.deepEqual(t.benefits.map((b) => b.roll), [1, 2, 3, 4], `${t.key} faces`);
    }
  });

  it("gives every trainer the metadata the window joins on", () => {
    for (const t of TRAINERS) {
      assert.ok(t.trainer, `${t.key} names its trainer`);
      assert.ok(t.table.endsWith("Training Benefits"), `${t.key} table name`);
      assert.ok(t.manifestId.startsWith("gmgwr-"), `${t.key} manifest id`);
      assert.equal(typeof t.page, "number");
    }
  });

  it("keys and table names are unique", () => {
    assert.equal(new Set(TRAINERS.map((t) => t.key)).size, 21);
    assert.equal(new Set(TRAINERS.map((t) => t.table)).size, 21);
  });

  // The whole point of the review: a benefit either computes or it says why
  // not. A recipe with neither changes nor a stated caveat is one somebody
  // started and did not finish.
  it("every benefit either computes something or says what the table must do", () => {
    for (const t of TRAINERS) {
      for (const b of t.benefits) {
        assert.ok(
          isMechanical(b) || b.todo,
          `${t.key}/${b.roll} is silent: no changes, no actions, no todo`
        );
      }
    }
  });

  it("writes changes in the v14 shape, not the numeric mode of older Foundry", () => {
    // `mode: 2` saves without error and then does nothing, so this is the one
    // mistake that cannot be caught by looking at the sheet.
    const seen = [];
    for (const t of TRAINERS) {
      for (const b of t.benefits) {
        const all = [...(b.changes ?? []), ...(b.choice ?? []).flatMap((c) => c.changes ?? [])];
        for (const c of all) {
          assert.equal(c.phase, "initial", `${t.key}/${b.roll} phase`);
          assert.ok(["add", "override"].includes(c.type), `${t.key}/${b.roll} type`);
          assert.equal(typeof c.value, "number", `${t.key}/${b.roll} value is a number`);
          assert.ok(!("mode" in c), `${t.key}/${b.roll} must not carry a numeric mode`);
          assert.ok(c.key.startsWith("system."), `${t.key}/${b.roll} key`);
          seen.push(c.key);
        }
      }
    }
    assert.ok(seen.length >= 20, "the mechanical benefits should carry real changes");
  });

  it("a two-branch benefit carries no changes of its own", () => {
    // Otherwise the grant would apply the shared changes AND a branch's, and
    // "+2 CHA or +4 renown" would quietly become both.
    for (const t of TRAINERS) {
      for (const b of t.benefits.filter((x) => x.choice)) {
        assert.ok(!b.changes, `${t.key}/${b.roll} choice must not also carry changes`);
        assert.ok(!b.actions, `${t.key}/${b.roll} choice must not also carry actions`);
        assert.equal(b.choice.length, 2);
        assert.equal(new Set(b.choice.map((c) => c.key)).size, 2);
      }
    }
  });

  it("Moon Fist's strike effects always grant the weapon they key off", () => {
    // The three effects select by the item's slugified NAME, so without the
    // item they are inert rather than wrong — the failure this pins.
    const moon = trainerByKey("moon-fist");
    for (const roll of [1, 2, 3]) {
      const b = benefitFor("moon-fist", roll);
      assert.ok(b.changes.every((c) => c.key.endsWith(".strikes")), `face ${roll} selects strikes`);
      assert.ok(
        b.actions.some((a) => a.type === "ensureWeapon" && a.name === "Strikes"),
        `face ${roll} must also ensure the Strikes item exists`
      );
    }
    assert.equal(moon.benefits[3].todo?.length > 0, true);
  });
});

describe("once each", () => {
  it("counts down as a trainer teaches", () => {
    assert.deepEqual(remainingRolls("bandit", []), [1, 2, 3, 4]);
    assert.deepEqual(remainingRolls("bandit", [2]), [1, 3, 4]);
    assert.deepEqual(remainingRolls("bandit", [1, 2, 3, 4]), []);
  });

  it("ignores a taken list that names faces the trainer does not have", () => {
    assert.deepEqual(remainingRolls("bandit", [7, "2"]), [1, 3, 4]);
  });

  it("returns nothing for an unknown trainer rather than throwing", () => {
    assert.deepEqual(remainingRolls("nobody", []), []);
    assert.equal(benefitFor("nobody", 1), null);
    assert.equal(trainerByKey("nobody"), null);
  });
});

describe("resolveRoll", () => {
  it("keeps the rolled face when it is still free", () => {
    assert.equal(resolveRoll("bandit", 3, []), 3);
    assert.equal(resolveRoll("bandit", 3, [1, 2]), 3);
  });

  it("walks up to the next free face, and wraps", () => {
    assert.equal(resolveRoll("bandit", 2, [2]), 3);
    assert.equal(resolveRoll("bandit", 4, [4]), 1);
    assert.equal(resolveRoll("bandit", 3, [3, 4]), 1);
  });

  it("returns null once the trainer is spent, instead of looping", () => {
    // A reroll-until-free implementation spins forever here. This is why the
    // walk exists.
    assert.equal(resolveRoll("bandit", 1, [1, 2, 3, 4]), null);
  });

  it("is deterministic for a given roll and taken list", () => {
    for (let i = 0; i < 5; i += 1) assert.equal(resolveRoll("bandit", 2, [2, 3]), 4);
  });
});

describe("isMechanical", () => {
  it("is false for prose and true for changes, actions, or either branch", () => {
    assert.equal(isMechanical(null), false);
    assert.equal(isMechanical({ label: "x", todo: "y" }), false);
    assert.equal(isMechanical(benefitFor("green-knight", 4)), true); // +1 AC
    assert.equal(isMechanical(benefitFor("witch", 4)), true);        // 1d4 HP action
    assert.equal(isMechanical(benefitFor("yodeling", 4)), true);     // one branch computes
    assert.equal(isMechanical(benefitFor("tomb-delver", 1)), false);
  });

  it("leaves Tomb Delver entirely to the table, on purpose", () => {
    // Narrow conditional advantages only. Granting the whole-ability advantage
    // key would buff every DEX or CON check in the game.
    for (const b of trainerByKey("tomb-delver").benefits) {
      assert.equal(isMechanical(b), false, `tomb-delver/${b.roll}`);
      assert.ok(b.todo);
    }
  });
});

describe("trainersByRegion", () => {
  it("groups by region and puts the unkeyed trainers last", () => {
    const groups = trainersByRegion();
    assert.equal(groups.at(-1).region, null);
    assert.deepEqual(
      groups.at(-1).trainers.map((t) => t.key).sort(),
      ["ancient-ritual", "swashbuckler", "tomb-delver"]
    );
    assert.equal(groups.reduce((n, g) => n + g.trainers.length, 0), 21);
  });

  it("keeps the two trainers a region prints together in one group", () => {
    const montmar = trainersByRegion().find((g) => g.region === "Duchy of Montmar");
    assert.deepEqual(montmar.trainers.map((t) => t.key), ["wizardly-arts", "healer"]);
  });
});

describe("trainer emblems", () => {
  it("gives all 21 trainers a distinct emblem that exists on disk", async () => {
    // A mapping that points at a missing file renders as a broken image, which
    // is worse than no image — so the file must exist, not merely be named.
    const { TRAINER_ART, trainerArt } = await import("../scripts/training/training-art.mjs");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.dirname(new URL(import.meta.url).pathname);

    assert.equal(Object.keys(TRAINER_ART).length, TRAINERS.length);
    assert.equal(new Set(Object.values(TRAINER_ART)).size, TRAINERS.length, "emblems must be distinct");

    for (const t of TRAINERS) {
      const file = TRAINER_ART[t.key];
      assert.ok(file, `${t.key} has no emblem`);
      const onDisk = path.join(root, "..", "icons", "game-icons", file);
      assert.ok(fs.existsSync(onDisk), `${t.key}: missing ${file}`);
      const svg = fs.readFileSync(onDisk, "utf8");
      // Pre-tinted gold in the file, the house treatment — no CSS filter.
      assert.match(svg, /fill="#c9a54a"/, `${t.key}: ${file} is not tinted gold`);
      assert.ok(trainerArt(t.key).endsWith(file));
    }
  });

  it("returns null for an unknown trainer rather than a broken path", async () => {
    const { trainerArt } = await import("../scripts/training/training-art.mjs");
    assert.equal(trainerArt("nobody"), null);
    assert.equal(trainerArt(undefined), null);
  });
});

describe("grantBenefit — the once-each record comes first", () => {
  /** An actor whose Talent write can fail, and whose HP write is recorded. */
  const makeActor = ({ failItem = false, failUpdate = false } = {}) => {
    const log = [];
    const items = [];
    return {
      log,
      items,
      system: { attributes: { hp: { max: 10, value: 10 } } },
      async createEmbeddedDocuments(_type, [data]) {
        log.push(`item:${data.type}`);
        if (failItem) throw new Error("create refused");
        const flags = data.flags ?? {};
        const item = { ...data, getFlag: (scope, key) => flags[scope]?.[key] };
        items.push(item);
        return [item];
      },
      async update() {
        log.push("update");
        if (failUpdate) throw new Error("update refused");
      },
    };
  };
  const withGame = async (fn) => {
    globalThis.game = { packs: [], tables: [] };
    globalThis.Roll = class { constructor() { this.total = 3; } async evaluate() { return this; } };
    try { return await fn(); } finally { delete globalThis.game; delete globalThis.Roll; }
  };

  it("pays nothing when the Talent cannot be created", async () => {
    const { grantBenefit } = await import("../scripts/training/training-grant.mjs");
    const actor = makeActor({ failItem: true });
    await withGame(() => assert.rejects(grantBenefit(actor, "witch", 4)));
    assert.deepEqual(actor.log, ["item:Talent"], "no HP written before the record");
  });

  it("keeps the face spent when an action fails, and says so", async () => {
    const { grantBenefit, takenRolls } = await import("../scripts/training/training-grant.mjs");
    const actor = makeActor({ failUpdate: true });
    const r = await withGame(() => grantBenefit(actor, "witch", 4));
    assert.equal(r.ok, true);
    assert.deepEqual(takenRolls(actor, "witch"), [4]);
    assert.match(r.notes.join(" "), /apply it by hand/);
    const again = await withGame(() => grantBenefit(actor, "witch", 4));
    assert.equal(again.error, "AlreadyTaught", "a retry cannot pay it twice");
  });
});
