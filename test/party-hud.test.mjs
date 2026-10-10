import test from "node:test";
import assert from "node:assert/strict";
import { isParty, Party } from "../scripts/party/party.mjs";
import { registerPartyHUD } from "../scripts/party/party-hud.mjs";
import { executeMovement, registerPartyMovement } from "../scripts/party/party-movement.mjs";
import { registerPartyLight } from "../scripts/party/party-light.mjs";
const MOD = "shadowdark-enhancer";
test("shared Party identity excludes flagged NPC and SDX Party but not real monsters", () => {
  assert.equal(isParty({ type: "NPC", flags: { [MOD]: { party: true } } }), true);
  assert.equal(isParty({ type: "NPC", flags: { "shadowdark-extras": { isParty: true } } }), true);
  assert.equal(isParty({ type: "Party" }), true);
  assert.equal(isParty({ type: "NPC", flags: {} }), false);
});
class Element {
  children = []; dataset = {}; listeners = {};
  setAttribute() {}
  addEventListener(name, callback) { this.listeners[name] = callback; }
  append(node) { this.children.push(node); }
  querySelector(selector) { return selector === ".col.right" ? this : this.children.find(c => c.className?.includes("sde-party-movement")); }
}
test("one owner HUD entry, visible combat reason, observer/NPC absence and unrelated controls preserved", () => {
  const hooks = new Map();
  globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn) };
  globalThis.HTMLElement = Element;
  globalThis.document = { createElement: () => new Element() };
  globalThis.game = { user: { isGM: false }, i18n: { localize: k => k }, combats: { contents: [] } };
  registerPartyHUD();
  const party = { type: "NPC", flags: { [MOD]: { party: true } }, testUserPermission: () => true };
  const hud = { object: { actor: party, document: { parent: { id: "s" } } } }, root = new Element();
  root.children.push({ className: "existing-reward-and-sync" });
  hooks.get("renderTokenHUD")(hud, root); hooks.get("renderTokenHUD")(hud, root);
  assert.equal(root.children.length, 2); assert.equal(root.children[1].title, "SDE.party.movement.importExport");
  globalThis.game.combats.contents = [{ started: true, scene: { id: "s" } }];
  const combatRoot = new Element(); hooks.get("renderTokenHUD")(hud, combatRoot);
  assert.equal(combatRoot.children[0].disabled, true); assert.equal(combatRoot.children[0].title, "SDE.party.movement.combat");
  party.testUserPermission = () => false;
  const observer = new Element(); hooks.get("renderTokenHUD")(hud, observer); assert.equal(observer.children.length, 0);
  party.testUserPermission = () => true; party.flags = {};
  const npc = new Element(); hooks.get("renderTokenHUD")(hud, npc); assert.equal(npc.children.length, 0);
});
function fixture() {
  const member = { id: "pc", uuid: "Actor.pc", type: "Player", name: "PC", testUserPermission: () => true };
  const party = { id: "p", uuid: "Actor.p", type: "NPC", flags: { [MOD]: { party: true, partyData: { members: [member.uuid], followLeader: false } } }, testUserPermission: u => u.id === "owner" || u.isGM };
  globalThis._replace = v => v;
  globalThis.PIXI = { Rectangle: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height, right: x + width, bottom: y + height }); } contains(x, y) { return x >= this.x && x < this.right && y >= this.y && y < this.bottom; } } };
  const hooks = new Map(); globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once: (name, fn) => hooks.set(name, fn), callAll() {} };
  const scene = { id: "s", walls: { contents: [] }, grid: { sizeX: 100, sizeY: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), getTopLeftPoint: o => ({ x: o.j * 100, y: o.i * 100 }), getAdjacentOffsets: o => [-1, 0, 1].flatMap(di => [-1, 0, 1].filter(dj => di || dj).map(dj => ({ i: o.i + di, j: o.j + dj }))) }, dimensions: { sceneRect: { x: 0, y: 0, width: 600, height: 600 } } };
  const makeToken = source => {
    const actor = source.actorId === "p" ? party : member;
    const doc = { ...source, id: source._id, uuid: `Scene.s.Token.${source._id}`, actor, parent: scene, _source: source, flags: source.flags ?? {}, toObject: () => ({ ...source, flags: doc.flags, x: doc.x, y: doc.y }),
      update: async changes => { for (const [key, value] of Object.entries(changes)) { if (key.startsWith("flags.")) doc.flags[MOD] = { ...doc.flags[MOD], [key.split(".")[2]]: value }; else doc[key] = value; } } };
    return doc;
  };
  const pt = makeToken({ _id: "pt", actorId: "p", actorLink: true, x: 300, y: 300, width: 1, height: 1, flags: {} });
  const pc = makeToken({ _id: "pcToken", actorId: "pc", actorLink: true, x: 0, y: 0, width: 1, height: 1, name: "custom config", light: { dim: 20 }, flags: {} });
  scene.tokens = { contents: [pt, pc], get(id) { return this.contents.find(d => d.id === id); }, has(id) { return !!this.get(id); } };
  const operations = [];
  scene.deleteEmbeddedDocuments = async (_type, ids) => { operations.push({ deleted: ids }); scene.tokens.contents = scene.tokens.contents.filter(d => !ids.includes(d.id)); };
  scene.createEmbeddedDocuments = async (_type, sources) => { operations.push({ created: sources.map(s => s._id) }); const docs = sources.map(makeToken); scene.tokens.contents.push(...docs); return docs; };
  scene.initialLevel = { id: "floor", parent: scene }; scene.levels = { get: () => scene.initialLevel };
  globalThis.canvas = { scene, ready: true };
  globalThis.game = { actors: { contents: [party, member], get: id => id === "p" ? party : member }, scenes: { get: () => scene }, user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } }, combats: { contents: [] }, i18n: { localize: k => k, format: k => k } };
  globalThis.CONFIG = { Canvas: { polygonBackends: { move: { testCollision: () => false } } }, queries: {} };
  const payload = { partyId: "p", sceneId: "s", tokenId: "pt" };
  return { scene, party, member, pc, pt, operations, payload, hooks };
}
test("authoritative gather/deploy cycles retain linked Actor and saved token config and never duplicate", async () => {
  const f = fixture(), owner = { id: "owner", isGM: false };
  const gathered = await executeMovement({ ...f.payload, action: "gather" }, owner);
  assert.deepEqual(gathered.gathered, ["pcToken"]); assert.equal(f.scene.tokens.contents.length, 1);
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, owner)).ok, true);
  const released = f.scene.tokens.get("pcToken"); assert.equal(released.actor, f.member); assert.equal(released.actorLink, true); assert.equal(released.name, "custom config");
  assert.deepEqual(released.light, { dim: 20 });
  await executeMovement({ ...f.payload, action: "deploy" }, owner); assert.equal(f.scene.tokens.contents.length, 2);
  await executeMovement({ ...f.payload, action: "gather" }, owner); await executeMovement({ ...f.payload, action: "deploy" }, owner);
  assert.equal(f.scene.tokens.contents.length, 2); assert.equal(f.scene.tokens.get("pcToken").actor, f.member);
  assert.deepEqual(f.party.flags[MOD].partyData.members, [f.member.uuid]);
});
test("a member the requester cannot see is never gathered or deployed for them", async () => {
  const f = fixture(), owner = { id: "owner", isGM: false };
  f.member.testUserPermission = u => !!u.isGM;   // a hidden actor the party's owner wrote into the member list
  const gathered = await executeMovement({ ...f.payload, action: "gather" }, owner);
  assert.deepEqual(gathered.gathered, []);
  assert.equal(f.scene.tokens.get("pcToken")?.actor, f.member, "its token stays where the GM put it");
  f.scene.tokens.contents = [f.pt];
  await executeMovement({ ...f.payload, action: "deploy" }, owner);
  assert.equal(f.scene.tokens.contents.length, 1, "and no token of it is placed");
});

test("relay checks authenticated sender and combat at execution, not the payload or button", async () => {
  const f = fixture(); registerPartyMovement();
  const request = globalThis.CONFIG.queries[`${MOD}.partyMovement`];
  const refused = await request({ ...f.payload, action: "gather", userId: "gm" }, { user: { id: "outsider" } });
  assert.equal(refused.ok, false); assert.equal(f.operations.length, 0);
  globalThis.game.combats.contents = [{ started: true, scene: f.scene }];
  for (const action of ["gather", "deploy"]) {
    const result = await request({ ...f.payload, action }, { user: { id: "owner" } }); assert.equal(result.ok, false); assert.match(result.error, /combat/);
  }
  assert.equal(f.operations.length, 0);
});
test("owner gather/release uses requested scene and level while GM views elsewhere", async () => {
  const f = fixture(), owner = { id: "owner" }, level = { id: "floor", parent: f.scene };
  f.pt._source.level = level.id; f.scene.levels = { get: id => id === level.id ? level : null };
  globalThis.canvas = { scene: { id: "other" }, ready: true };
  const configs = [];
  globalThis.CONFIG.Canvas.polygonBackends.move.testCollision = (_a, _b, config) => { configs.push(config); return false; };
  assert.equal((await executeMovement({ ...f.payload, action: "gather" }, owner)).ok, true);
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, owner)).ok, true);
  assert.ok(configs.length > 0); assert.ok(configs.every(c => c.level === level));
  assert.equal(globalThis.canvas.scene.id, "other"); assert.equal(f.scene.tokens.get("pcToken").actor, f.member);
});
test("Party light uses current then packed state, never extinguished placement defaults", () => {
  const f = fixture();
  const off = { dim: 0, bright: 0 }, on = { dim: 20, bright: 10 };
  f.pt._source.light = off; f.pc._source.light = off;
  f.party.prototypeToken = { light: on }; f.member.prototypeToken = { light: on };
  globalThis.foundry = { data: { LightData: class { constructor(value) { Object.assign(this, value); } } } };
  globalThis.CONFIG.Token = { documentClass: class { prepareDerivedData() { this.light = this._source.light; } } };
  registerPartyLight(); const doc = new globalThis.CONFIG.Token.documentClass(); Object.assign(doc, f.pt);
  doc.prepareDerivedData(); assert.equal(doc.light.dim, 0);
  f.pc._source.light = on; doc.prepareDerivedData(); assert.equal(doc.light.dim, 20);
  f.pc._source.light = off;
  f.pt.flags[MOD] = { partyMovement: { packed: [{ actorId: f.member.id, light: on }] } };
  doc.prepareDerivedData(); assert.equal(doc.light.dim, 0, "current off overrides earlier packed on");
  f.scene.tokens.contents = [f.pt]; doc.prepareDerivedData(); assert.equal(doc.light.dim, 20);
  f.pt.flags[MOD].partyMovement.packed[0].light = off; doc.prepareDerivedData(); assert.equal(doc.light.dim, 0);
  f.pt._source.light = on; doc.prepareDerivedData(); assert.equal(doc.light.dim, 20, "independent shared light remains valid");
  f.scene.grid.isHexagonal = true; doc.prepareDerivedData(); assert.equal(doc.light, on);
  assert.equal(f.member.prototypeToken.light, on); assert.equal(f.party.prototypeToken.light, on);
});
test("gather checks combat before its first save, so a mid-save combat cannot half-gather", async () => {
  const f = fixture(), owner = { id: "owner", isGM: false };
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, owner)).ok, true);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const base = f.pt.update; let first = true;
  f.pt.update = changes => { if (first) { first = false; return gate.then(() => base(changes)); } return base(changes); };
  const started = executeMovement({ ...f.payload, action: "gather" }, owner);
  await new Promise(resolve => setImmediate(resolve));
  globalThis.game.combats.contents = [{ started: true, scene: f.scene }];
  release();
  const result = await started;
  assert.equal(result.ok, true, "the guard runs before the first write; combat starting during it cannot abort a persisted gather");
  assert.equal(f.scene.tokens.get("pcToken"), undefined);
  assert.equal(f.pt.flags[MOD].partyMovement.deployed, false);
});
test("a roster edit while deployed is swept when the party is recalled", async () => {
  const f = fixture(), owner = { id: "owner", isGM: false };
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, owner)).ok, true);
  assert.equal(f.scene.tokens.contents.length, 2);
  f.party.flags[MOD].partyData.members = [];
  assert.equal((await executeMovement({ ...f.payload, action: "gather" }, owner)).ok, true);
  assert.equal(f.scene.tokens.contents.length, 1, "the removed member's deployed token is recalled too");
  assert.equal(f.scene.tokens.get("pcToken"), undefined);
  assert.ok(f.operations.some(op => op.deleted?.includes("pcToken")));
});
test("a leader drag during a recall queues behind it and the recall lands clean", async () => {
  const f = fixture(); registerPartyMovement();
  globalThis.ui = { notifications: { warn() {} } };
  globalThis.CONFIG.Token = { movement: { actions: {} } };
  f.party.flags[MOD].partyData = { members: [f.member.uuid], leaderUuid: f.member.uuid, followLeader: true };
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, { id: "owner", isGM: false })).ok, true);
  // A second roster member with a deployed token of its own.
  const m2 = { id: "pc2", uuid: "Actor.pc2", type: "Player", name: "PC2", testUserPermission: () => true };
  globalThis.game.actors.contents.push(m2);
  const source2 = { _id: "pc2Token", actorId: "pc2", actorLink: true, x: 100, y: 0, width: 1, height: 1, name: "PC2", light: { dim: 0 }, flags: { [MOD]: { partyMovement: { partyUuid: f.party.uuid } } } };
  const pc2Token = { ...source2, id: "pc2Token", uuid: "Scene.s.Token.pc2Token", actor: m2, parent: f.scene, _source: source2, toObject: () => ({ ...source2 }) };
  f.scene.tokens.contents.push(pc2Token);
  f.party.flags[MOD].partyData.members = [f.member.uuid, m2.uuid];
  let release; const gate = new Promise(resolve => { release = resolve; });
  const base = f.pt.update; let first = true;
  f.pt.update = changes => { if (first) { first = false; return gate.then(() => base(changes)); } return base(changes); };
  const gather = executeMovement({ ...f.payload, action: "gather" }, { id: "owner", isGM: false });
  await new Promise(resolve => setImmediate(resolve));
  const moves = [];
  for (const token of f.scene.tokens.contents) token.move = async () => { moves.push(token.id); return true; };
  f.hooks.get("moveToken")(f.scene.tokens.get("pcToken"), { passed: { waypoints: [{ x: 350, y: 300, elevation: 0, action: "walk", checkpoint: true }] }, origin: { x: 300, y: 300 } }, {}, { id: "owner" });
  release();
  assert.equal((await gather).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(moves, [], "the leader drag must not move followers mid-recall");
  assert.equal(f.pt.flags[MOD].partyMovement.deployed, false);
});
test("party light refresh only pays perception updates when a party token's light changed", () => {
  const f = fixture();
  const updates = [];
  globalThis.canvas = { ready: true, scene: f.scene, perception: { update: options => updates.push(options) }, tokens: { placeables: [] } };
  globalThis.CONFIG.Token = { documentClass: class { prepareDerivedData() {} } };
  registerPartyLight();
  f.hooks.get("updateItem")({ parent: { uuid: "Actor.foreign", type: "NPC", flags: {} } });
  assert.equal(updates.length, 0, "an unrelated actor's item cannot trigger a scene-wide refresh");
  let sourceLight = { dim: 0, bright: 0 };
  const doc = { flags: {}, _source: { light: { dim: 0, bright: 0 } }, light: { dim: 0, bright: 0 }, prepareData() { this.light = { ...sourceLight }; } };
  globalThis.canvas.tokens.placeables = [{ document: doc, actor: f.party, initializeLightSource() {} }];
  f.hooks.get("updateToken")();
  assert.equal(updates.length, 0, "an unchanged party light does not pay a perception update");
  sourceLight = { dim: 30, bright: 10 };
  f.hooks.get("updateToken")();
  assert.equal(updates.length, 1, "a changed mirrored light refreshes once");
  f.hooks.get("updateToken")();
  assert.equal(updates.length, 1, "unchanged follow-ups stay free");
  f.hooks.get("updateItem")({ parent: f.party });
  assert.equal(updates.length, 1, "party item hooks still reach the refresh, which stays gated on change");
});
test("character rosters follow the system's isPC getter, not the raw document type", () => {
  const mislabeled = { uuid: "Actor.mislabeled", type: "Player", system: { isPC: false } };
  const real = { uuid: "Actor.real", type: "Player", system: { isPC: true } };
  const party = { id: "p2", uuid: "Actor.p2", type: "NPC", flags: { [MOD]: { party: true, partyData: { members: [mislabeled.uuid, real.uuid] } } }, testUserPermission: () => true };
  globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: [party, mislabeled, real], get: id => id === "p2" ? party : null } };
  assert.deepEqual(Party.members(party, { charactersOnly: true }), [real.uuid]);
});
test("a follower that cannot step stays put and the party keeps following; nothing is paused", async () => {
  const f = fixture(); registerPartyMovement();
  globalThis.CONFIG.Token = { movement: { actions: {} } };
  f.party.flags[MOD].partyData = { members: [f.member.uuid], leaderUuid: f.member.uuid, followLeader: true };
  const owner = { id: "owner", isGM: false };
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, owner)).ok, true);
  const m2 = { id: "pc2", uuid: "Actor.pc2", type: "Player", name: "PC2", testUserPermission: () => true };
  globalThis.game.actors.contents.push(m2);
  const source2 = { _id: "pc2Token", actorId: "pc2", actorLink: true, x: 100, y: 0, width: 1, height: 1, name: "PC2", flags: { [MOD]: { partyMovement: { partyUuid: f.party.uuid } } } };
  const pc2 = { ...source2, id: "pc2Token", uuid: "Scene.s.Token.pc2Token", actor: m2, parent: f.scene, _source: source2, toObject: () => ({ ...source2 }) };
  f.scene.tokens.contents.push(pc2);
  f.party.flags[MOD].partyData.members = [f.member.uuid, m2.uuid];
  const moves = []; pc2.move = async path => { moves.push(path.length); return false; };
  const leaderMove = () => f.hooks.get("moveToken")(f.scene.tokens.get("pcToken"), { passed: { waypoints: [{ x: 350, y: 300, elevation: 0, action: "walk", checkpoint: true }] }, origin: { x: 300, y: 300 } }, {}, { id: "owner" });
  leaderMove(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(moves, [1], "the blocked follower was tried");
  assert.equal(f.pt.flags[MOD].partyMovement.deployed, true);
  assert.equal(f.pt.flags[MOD].partyMovement.pause, undefined, "no pause state exists");
  pc2.move = async path => { moves.push(path.length); return true; };
  leaderMove(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(moves, [1, 1], "the next leader move simply tries again, no resume");
});
function marchFixture(at = { x: 100, y: 0 }) {
  const f = fixture(); registerPartyMovement();
  globalThis.CONFIG.Token = { movement: { actions: {} } };
  const m2 = { id: "pc2", uuid: "Actor.pc2", type: "Player", name: "PC2", testUserPermission: () => true };
  globalThis.game.actors.contents.push(m2);
  // Leader is slot (col 0, row -1), PC2 sits one row below it (col 0, row 0).
  f.party.flags[MOD].partyData = { members: [f.member.uuid, m2.uuid], leaderUuid: f.member.uuid, followLeader: true,
    formation: { slots: [{ memberUuid: f.member.uuid, col: 0, row: -1 }, { memberUuid: m2.uuid, col: 0, row: 0 }] } };
  const source2 = { _id: "pc2Token", actorId: "pc2", actorLink: true, ...at, width: 1, height: 1, name: "PC2", flags: { [MOD]: { partyMovement: { partyUuid: f.party.uuid } } } };
  const pc2 = { ...source2, id: "pc2Token", uuid: "Scene.s.Token.pc2Token", actor: m2, parent: f.scene, _source: source2, toObject: () => ({ ...source2 }) };
  f.scene.tokens.contents.push(pc2);
  f.pt.flags[MOD] = { partyMovement: { deployed: true } };
  const paths = []; pc2.move = async path => { paths.push(path.map(p => [p.x, p.y])); return true; };
  const way = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  const leaderMove = async (heading = "north") => {
    const [dx, dy] = way[heading], at = n => ({ x: 300 + dx * 100 * n, y: 300 + dy * 100 * n, elevation: 0, action: "walk", checkpoint: true });
    f.hooks.get("moveToken")(f.scene.tokens.get("pcToken"), { passed: { waypoints: [at(1), at(2)] }, origin: { x: 300, y: 300 } }, {}, { id: "owner" });
    await new Promise(resolve => setImmediate(resolve));
  };
  return { f, paths, leaderMove };
}
test("followers keep their formation slot, turned to face the way the leader walks", async () => {
  // PC2 sits one row behind the leader (col 0, row +1): behind means opposite the heading.
  for (const [heading, expected] of [["north", [300, 200]], ["east", [400, 300]], ["south", [300, 400]], ["west", [200, 300]]]) {
    const { paths, leaderMove } = marchFixture({ x: 100, y: 500 });
    globalThis.CONFIG.Canvas.polygonBackends.move.testCollision = () => false;
    await leaderMove(heading);
    assert.deepEqual(paths, [[expected]], heading);
  }
});
test("a follower riding a mount stays with its mount; once off it, it follows again (#326)", async () => {
  const { f, paths, leaderMove } = marchFixture({ x: 100, y: 500 });
  const pc2 = f.scene.tokens.get("pc2Token");
  f.scene.tokens.contents.push({ id: "horse", flags: {} });
  pc2.flags[MOD].mountedOn = "horse";
  await leaderMove("north");
  assert.deepEqual(paths, [], "the rider is not walked off its horse");
  pc2.flags[MOD].mountedOn = null;
  await leaderMove("north");
  assert.equal(paths.length, 1);
});
test("turning the leader around reverses the order", async () => {
  const north = marchFixture({ x: 100, y: 500 }), south = marchFixture({ x: 100, y: 500 });
  await north.leaderMove("north"); await south.leaderMove("south");
  assert.equal(north.paths[0][0][1] > 100, true, "behind a northbound leader is south of him");
  assert.equal(south.paths[0][0][1] < 500, true);
  assert.notDeepEqual(north.paths, south.paths);
});
test("a follower whose slot is walled off goes to the nearest square it can reach", async () => {
  const { paths, leaderMove } = marchFixture();
  // The whole row y=200 (the slot's row for a northbound leader) is rock.
  globalThis.CONFIG.Canvas.polygonBackends.move.testCollision = (a, b) => a.y === 250 || b.y === 250;
  await leaderMove("north");
  assert.equal(paths.length, 1);
  assert.ok(paths[0].every(([, y]) => y !== 200), "never enters the walled row");
  assert.equal(paths[0].at(-1)[1], 100, "ends level with the leader, the reachable row nearest the slot");
});
test("a follower shut in a room with the door elsewhere walks round to its slot instead of being stranded", async () => {
  // A wall along y=500 with one gap in the column x=300; PC2 starts below it, the slot is above it.
  const { paths, leaderMove } = marchFixture({ x: 100, y: 600 });
  globalThis.CONFIG.Canvas.polygonBackends.move.testCollision = (a, b) => (a.y < 500) !== (b.y < 500) && !(a.x === 350 && b.x === 350);
  await leaderMove("north");
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].at(-1), [300, 200], "reaches its slot");
  assert.ok(paths[0].some(([x, y]) => x === 300 && y === 400), "comes through the gap in the wall");
  assert.ok(paths[0].every((p, i) => i === 0 || Math.max(Math.abs(p[0] - paths[0][i - 1][0]), Math.abs(p[1] - paths[0][i - 1][1])) === 100), "one square at a time");
});
