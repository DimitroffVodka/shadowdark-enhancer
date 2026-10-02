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
  const scene = { id: "s", walls: { contents: [] }, grid: { sizeX: 100, sizeY: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), getTopLeftPoint: o => ({ x: o.j * 100, y: o.i * 100 }) }, dimensions: { sceneRect: { x: 0, y: 0, width: 600, height: 600 } } };
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
test("GM driving a Party pauses on navigation and requires Resume; relay GM navigation does not pause player", async () => {
  const f = fixture(); registerPartyMovement();
  globalThis.ui = { notifications: { warn() {} } };
  f.hooks.get("canvasReady")();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const status = () => f.pt.flags[MOD].partyMovement;
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, globalThis.game.user)).ok, true);
  f.hooks.get("canvasTearDown")(); await flush();
  assert.equal(status().pause, "scene");
  assert.equal(status().driverUserId, "gm");
  f.hooks.get("canvasReady")(); await flush();
  assert.equal(status().pause, "scene", "returning must preserve scene pause");
  assert.equal((await executeMovement({ ...f.payload, action: "resume" }, globalThis.game.user)).ok, true);
  assert.equal(status().pause, "");
  globalThis.game.scenes.contents = [f.scene];
  f.hooks.get("ready")(); await flush();
  assert.equal(status().pause, "reload", "driving GM client reload pauses too");
  const owner = { id: "owner", isGM: false, hasPermission: () => true };
  await executeMovement({ ...f.payload, action: "resume" }, owner);
  assert.equal(status().driverUserId, "owner");
  f.hooks.get("canvasTearDown")(); f.hooks.get("canvasReady")(); await flush();
  assert.equal(status().pause, "", "unrelated authority navigation cannot disarm player marching");
  globalThis.game.user = owner;
  globalThis.game.users.activeGM.query = (_name, payload) => executeMovement(payload, owner);
  f.hooks.get("canvasTearDown")(); await flush();
  assert.equal(status().pause, "scene", "driving player uses relay on navigation");
  await executeMovement({ ...f.payload, action: "resume" }, owner);
  globalThis.canvas = { scene: { id: "other", tokens: { contents: [] } } };
  f.hooks.get("ready")(); await flush();
  assert.equal(status().pause, "reload", "player reload pauses driven Party even when initially viewing another scene");
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
  assert.equal(f.pt.flags[MOD].partyMovement.pause, "gathered");
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
test("the reload pause queues behind an in-flight movement write on the same token", async () => {
  const f = fixture(); registerPartyMovement();
  globalThis.ui = { notifications: { warn() {} } };
  globalThis.game.scenes.contents = [f.scene];
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, globalThis.game.user)).ok, true);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const base = f.pt.update; let first = true;
  f.pt.update = changes => { if (first) { first = false; return gate.then(() => base(changes)); } return base(changes); };
  const resume = executeMovement({ ...f.payload, action: "resume" }, globalThis.game.user);
  await new Promise(resolve => setImmediate(resolve));
  f.hooks.get("ready")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pt.flags[MOD].partyMovement.pause, "", "the reload pause must wait for the in-flight movement write");
  release();
  await resume;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pt.flags[MOD].partyMovement.pause, "reload");
});
test("a deleted leader token pauses with the missing member named", async () => {
  const f = fixture(); registerPartyMovement();
  f.party.flags[MOD].partyData = { members: [f.member.uuid], leaderUuid: f.member.uuid, followLeader: true };
  assert.equal((await executeMovement({ ...f.payload, action: "deploy" }, { id: "owner", isGM: false })).ok, true);
  f.hooks.get("deleteToken")(f.scene.tokens.get("pcToken"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pt.flags[MOD].partyMovement.pause, "missing");
  assert.equal(f.pt.flags[MOD].partyMovement.pausedMemberUuid, f.member.uuid, "the sheet can name the missing member");
});
test("a second tab of the same GM user cannot pause the driving tab's march", async () => {
  const f = fixture(); registerPartyMovement();
  globalThis.ui = { notifications: { warn() {} } };
  const store = () => { const m = new Map(); return { getItem: key => m.get(key) ?? null, setItem: (key, value) => m.set(key, String(value)) }; };
  const tabA = store(), tabB = store();
  tabA.setItem(`${MOD}.movementDriverClient`, "client-a");
  tabB.setItem(`${MOD}.movementDriverClient`, "client-b");
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const status = () => f.pt.flags[MOD].partyMovement;
  try {
    globalThis.sessionStorage = tabA;
    assert.equal((await executeMovement({ ...f.payload, action: "deploy", clientId: "client-a" }, globalThis.game.user)).ok, true);
    globalThis.sessionStorage = tabB;
    f.hooks.get("canvasTearDown")(); await flush();
    assert.equal(status().pause, "", "a second tab navigating must not pause the driving tab's march");
    f.hooks.get("canvasReady")(); await flush();
    assert.equal(status().pause, "");
    globalThis.sessionStorage = tabA;
    f.hooks.get("canvasTearDown")(); await flush();
    assert.equal(status().pause, "scene", "the driving tab itself still pauses");
  } finally { delete globalThis.sessionStorage; }
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
  const deleteBase = f.scene.deleteEmbeddedDocuments;
  f.scene.deleteEmbeddedDocuments = async (type, ids) => {
    const docs = ids.map(id => f.scene.tokens.get(id)).filter(Boolean);
    const result = await deleteBase(type, ids);
    for (const doc of docs) f.hooks.get("deleteToken")(doc);
    return result;
  };
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
  assert.equal(f.pt.flags[MOD].partyMovement.pause, "gathered", "the recall's own leader deletion cannot pause it as missing");
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
