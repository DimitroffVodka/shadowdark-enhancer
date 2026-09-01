import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import { commitRivalPartyPreview } from "../scripts/forge-loot/rival-party-adapter.mjs";

function folder(id, name, parent = null, contents = [], children = []) {
  return {
    id,
    name,
    type: "Actor",
    folder: parent,
    contents,
    children,
    deleted: false,
    async delete() { this.deleted = true; },
  };
}

function preview(mode = "folder") {
  return {
    commitTarget: { mode, reason: mode === "folder" ? "sdx-absent" : "sdx-party-enabled" },
    shared: {
      partyName: "Iron Stars",
      alignment: "lawful",
      renown: "Noted",
      secret: "Owes the crown",
      wealth: "Well equipped",
      signatureTactics: "Shield wall",
    },
    members: [
      {
        actorData: {
          name: "Arden",
          type: "Player",
          pack: "Compendium.ignored",
          system: { level: { value: 2 } },
          items: [{ name: "Battle Training", type: "Talent", system: {}, effects: [] }],
        },
      },
      { actorData: { name: "Bryn", type: "Player", system: { level: { value: 4 } }, items: [] } },
    ],
  };
}

test("commit suffixes populated party folders and creates only world Player Actors from the approved preview", async () => {
  const parent = folder("parent", "Rival Crawlers");
  const base = folder("base", "Iron Stars", parent, [{ id: "old-a" }]);
  const second = folder("second", "Iron Stars (2)", parent, [{ id: "old-b" }]);
  const folders = [parent, base, second];
  const creates = [];
  const Folder = {
    async create(data) {
      const created = folder(`folder-${folders.length}`, data.name, data.folder ?? null);
      folders.push(created);
      return created;
    },
  };
  const Actor = {
    async create(data, options) {
      const created = {
        id: `actor-${creates.length}`,
        ...structuredClone(data),
        options,
        async delete() {},
      };
      creates.push(created);
      return created;
    },
  };
  const game = {
    folders,
    modules: new Map([[MODULE_ID, { version: "0.15.1" }]]),
  };
  const approved = preview();

  const result = await commitRivalPartyPreview({
    preview: approved,
    seed: "party-seed",
    game,
    Folder,
    Actor,
  });

  assert.equal(result.folderName, "Iron Stars (3)");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates.map((actor) => actor.name), ["Arden", "Bryn"]);
  assert.ok(creates.every((actor) => actor.type === "Player"));
  assert.ok(creates.every((actor) => actor.options === undefined));
  assert.ok(creates.every((actor) => !Object.hasOwn(actor, "pack")));
  assert.deepEqual(creates[0].items, [
    { name: "Battle Training", type: "Talent", system: {}, effects: [] },
  ], "approved embedded Items are created atomically with the Player Actor");
  assert.ok(creates.every((actor) => actor.folder === result.folderId));
  assert.ok(creates.every((actor) => actor.flags[MODULE_ID].generated.tool === "rival-crawlers"));
  assert.ok(creates.every((actor) => actor.flags[MODULE_ID].generated.seed === "party-seed"));
  assert.ok(creates.every((actor) => actor.type !== "Party"));
  assert.ok(creates.every((actor) => /<strong>Party:<\/strong> Iron Stars/.test(actor.system.notes)));
  assert.ok(creates.every((actor) => /<strong>Signature Tactics:<\/strong> Shield wall/.test(actor.system.notes)));
  assert.equal(result.mode, "folder");
  assert.equal(result.partyActorId, null);
  assert.deepEqual(approved, preview(), "commit must not edit or regenerate the approved preview");
});

test("a mid-commit failure removes only this attempt's Actors and new folder", async () => {
  const parent = folder("parent", "Rival Crawlers");
  const unrelated = folder("unrelated", "Other Party", parent, [{ id: "old" }]);
  const folders = [parent, unrelated];
  const createdFolders = [];
  const deletedActors = [];
  const Folder = {
    async create(data) {
      const created = folder(`folder-${folders.length}`, data.name, data.folder ?? null);
      folders.push(created);
      createdFolders.push(created);
      return created;
    },
  };
  let calls = 0;
  const Actor = {
    async create(data) {
      calls += 1;
      if (calls === 2) throw new Error("forced second Actor failure");
      return {
        id: "created-first",
        ...structuredClone(data),
        async delete() { deletedActors.push(this.id); },
      };
    },
  };

  await assert.rejects(
    commitRivalPartyPreview({
      preview: preview(),
      seed: "failure-seed",
      game: { folders, modules: new Map() },
      Folder,
      Actor,
    }),
    (error) => error.code === "party-commit-failed"
      && error.role === "Iron Stars"
      && /no partial party/i.test(error.message),
  );

  assert.deepEqual(deletedActors, ["created-first"]);
  assert.equal(createdFolders.length, 1);
  assert.equal(createdFolders[0].deleted, true);
  assert.equal(parent.deleted, false);
  assert.equal(unrelated.deleted, false);
  assert.equal(unrelated.contents.length, 1);
});

test("an identically named empty folder is reused and preserved if creation fails", async () => {
  const parent = folder("parent", "Rival Crawlers");
  const empty = folder("empty", "Iron Stars", parent, []);
  const folders = [parent, empty];
  let folderCreates = 0;
  const Folder = { async create() { folderCreates += 1; throw new Error("unexpected folder create"); } };
  const Actor = { async create() { throw new Error("forced first Actor failure"); } };

  await assert.rejects(commitRivalPartyPreview({
    preview: preview(),
    seed: "reuse-seed",
    game: { folders, modules: new Map() },
    Folder,
    Actor,
  }), { code: "party-commit-failed" });

  assert.equal(folderCreates, 0);
  assert.equal(empty.deleted, false);
  assert.equal(parent.deleted, false);
});

test("a party folder containing a child folder is populated and must be suffixed", async () => {
  const parent = folder("parent", "Rival Crawlers");
  const base = folder("base", "Iron Stars", parent);
  const child = folder("child", "Veterans", base);
  base.children.push(child);
  const folders = [parent, base, child];
  const createdNames = [];
  const Folder = {
    async create(data) {
      const created = folder(`folder-${folders.length}`, data.name, data.folder ?? null);
      folders.push(created);
      createdNames.push(created.name);
      return created;
    },
  };
  const Actor = {
    async create(data) {
      return { id: `actor-${data.name}`, ...structuredClone(data), async delete() {} };
    },
  };

  const result = await commitRivalPartyPreview({
    preview: preview(),
    seed: "child-folder",
    game: { folders, modules: new Map() },
    Folder,
    Actor,
  });

  assert.equal(result.folderName, "Iron Stars (2)");
  assert.deepEqual(createdNames, ["Iron Stars (2)"]);
});

test("commit refuses when the live SDX target differs from the approved preview", async () => {
  let folderWrites = 0;
  let actorWrites = 0;
  await assert.rejects(commitRivalPartyPreview({
    preview: preview("folder"),
    seed: "target-drift",
    game: {
      folders: [],
      modules: new Map([["shadowdark-extras", { active: true }]]),
      settings: { get: () => [] },
    },
    Folder: { async create() { folderWrites += 1; } },
    Actor: { async create() { actorWrites += 1; } },
  }), (error) => error.code === "party-commit-target-changed"
    && error.role === "Party organisation"
    && /changed.*generate a fresh preview/i.test(error.message));

  assert.equal(folderWrites, 0);
  assert.equal(actorWrites, 0);
});

test("an active shadowdark-extras integration creates one Party actor linked to every member", async () => {
  const creates = [];
  const Actor = {
    async create(data, options) {
      const created = {
        id: `actor-${creates.length + 1}`,
        ...structuredClone(data),
        options,
        async delete() {},
      };
      creates.push(created);
      return created;
    },
  };
  const game = {
    folders: [],
    settings: { get: () => [] },
    modules: new Map([
      [MODULE_ID, { version: "0.15.1" }],
      ["shadowdark-extras", { active: true, api: {} }],
    ]),
  };
  const Folder = { async create() { throw new Error("SDX parties do not need folders"); } };

  const result = await commitRivalPartyPreview({
    preview: preview("party-token"),
    seed: "sdx-seed",
    game,
    Folder,
    Actor,
  });

  assert.equal(result.mode, "party-token");
  assert.equal(creates.length, 3);
  assert.deepEqual(creates.map((actor) => actor.type), ["Player", "Player", "NPC"]);
  assert.equal(creates[2].name, "Iron Stars");
  assert.equal(creates[2].system.alignment, "lawful");
  assert.equal(creates[2].flags["shadowdark-extras"].isParty, true);
  assert.deepEqual(creates[2].flags["shadowdark-extras"].members, ["actor-1", "actor-2"]);
  assert.match(creates[2].flags["shadowdark-extras"].description, /<strong>Alignment:<\/strong> lawful/);
  assert.match(creates[2].flags["shadowdark-extras"].description, /<strong>Renown:<\/strong>/);
  assert.equal(result.partyActorId, "actor-3");
  assert.deepEqual(result.actorIds, ["actor-1", "actor-2"]);
  assert.ok(creates.every((actor) => actor.options === undefined));
});

test("a failed Party actor creation rolls back all members when shadowdark-extras is active", async () => {
  const deleted = [];
  let calls = 0;
  const Actor = {
    async create(data) {
      calls += 1;
      if (data.flags?.["shadowdark-extras"]?.isParty) throw new Error("forced Party failure");
      return {
        id: `member-${calls}`,
        ...structuredClone(data),
        async delete() { deleted.push(this.id); },
      };
    },
  };

  await assert.rejects(commitRivalPartyPreview({
    preview: preview("party-token"),
    seed: "party-failure",
    game: {
      modules: new Map([["shadowdark-extras", { active: true, api: {} }]]),
      settings: { get: () => [] },
    },
    Folder: { async create() { throw new Error("unexpected folder"); } },
    Actor,
  }), (error) => error.code === "party-commit-failed" && /Party failure/.test(error.message));

  assert.deepEqual(deleted, ["member-2", "member-1"]);
});

test("disabled SDX party management uses the same folder fallback as an absent module", async () => {
  const folders = [];
  const creates = [];
  const Folder = {
    async create(data) {
      const created = folder(`folder-${folders.length + 1}`, data.name, data.folder ?? null);
      folders.push(created);
      return created;
    },
  };
  const Actor = {
    async create(data) {
      const created = { id: `actor-${creates.length + 1}`, ...structuredClone(data), async delete() {} };
      creates.push(created);
      return created;
    },
  };
  const result = await commitRivalPartyPreview({
    preview: preview(),
    seed: "disabled-sdx",
    game: {
      folders,
      modules: new Map([["shadowdark-extras", { active: true, api: {} }]]),
      settings: { get: () => ["party.management"] },
    },
    Folder,
    Actor,
  });

  assert.equal(result.mode, "folder");
  assert.equal(creates.length, 2);
  assert.ok(creates.every((actor) => actor.type === "Player"));
  assert.ok(creates.every((actor) => /<strong>Renown:<\/strong> Noted/.test(actor.system.notes)));
});
