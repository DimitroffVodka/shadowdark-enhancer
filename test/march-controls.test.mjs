import test from "node:test";
import assert from "node:assert/strict";
import { Party } from "../scripts/party/party.mjs";
import { marchButtonHTML, marchGridHTML, bindMarchControls } from "../scripts/crawl-strip/march-controls.mjs";
import { moveToSlot } from "../scripts/party/party-movement-core.mjs";

const MOD = "shadowdark-enhancer";
function world({ gm = true } = {}) {
  const mk = (id, name) => ({ id, uuid: `Actor.${id}`, type: "Player", name, img: `${id}.png`, testUserPermission: () => true });
  const [a, b, c] = [mk("a", "Ayla"), mk("b", "Bran <b>"), mk("c", "Cato")];
  const writes = [];
  const party = { id: "p", uuid: "Actor.p", type: "NPC", name: "Party", flags: { [MOD]: { party: true, partyData: { members: [a.uuid, b.uuid, c.uuid], leaderUuid: a.uuid, followLeader: true,
    formation: { slots: [{ memberUuid: a.uuid, col: 0, row: -1 }, { memberUuid: b.uuid, col: 0, row: 0 }, { memberUuid: c.uuid, col: 0, row: 1 }] } } } },
    testUserPermission: () => gm,
    update: async changes => { writes.push(changes); for (const [k, v] of Object.entries(changes)) if (k.startsWith(`flags.${MOD}.`)) party.flags[MOD][k.split(".")[2]] = v; } };
  globalThis._replace = v => v;
  globalThis.ui = { notifications: { warn() {} } };
  globalThis.game = { user: { isGM: gm }, i18n: { format: (k, d) => `${k}${d?.name ? `|${d.name}` : ""}`, localize: k => k }, actors: { contents: [party, a, b, c], get: id => [party, a, b, c].find(x => x.id === id) } };
  return { party, a, b, c, writes };
}
function fakeRoot(party) {
  const el = (attrs = {}) => ({ dataset: attrs, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, closest: () => grid });
  const grid = { dataset: { partyId: party.id } };
  const button = el({ partyId: party.id });
  const cells = [];
  for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) cells.push(el({ row: String(row), col: String(col), uuid: "" }));
  return { button, cells, querySelector: () => button, querySelectorAll: () => cells };
}
const evt = (extra = {}) => ({ preventDefault() { this.prevented = true; }, stopPropagation() {}, dataTransfer: { data: "", setData(_t, v) { this.data = v; }, getData() { return this.data; } }, ...extra });
const settle = () => new Promise(resolve => setImmediate(resolve));

test("the grid draws nine cells from the front, names its leader, escapes names, and is draggable only for a manager", () => {
  const { party } = world();
  const html = marchGridHTML(party, { canEdit: true });
  assert.equal(html.match(/data-march-slot/g).length, 9);
  assert.match(html, /sde-strip-march-cell leader" data-march-slot data-row="-1" data-col="0" data-uuid="Actor.a"/, "Ayla leads from the front row");
  assert.equal(html.match(/draggable="true"/g).length, 3, "only cells that hold someone");
  assert.equal(html.match(/sde-strip-march-cell empty/g).length, 6);
  assert.doesNotMatch(html, /Bran <b>/, "a name is never raw markup");
  assert.doesNotMatch(marchGridHTML(party, { canEdit: false }), /draggable/);
});
test("the switch says what it will do: on and marching, on and waiting, off", () => {
  const { party } = world();
  assert.match(marchButtonHTML(party, { active: true }), /class="sde-strip-march-btn on active"[^>]*title="SDE.crawlStrip.marchOn"/);
  assert.match(marchButtonHTML(party, { active: false }), /class="sde-strip-march-btn on "[^>]*title="SDE.crawlStrip.marchWaiting"/);
  party.flags[MOD].partyData.followLeader = false;
  assert.match(marchButtonHTML(party, { active: false }), /aria-pressed="false"[^>]*title="SDE.crawlStrip.marchOff"/);
});
test("the switch flips Marching order on the party, for a manager only", async () => {
  const { party, writes } = world();
  const root = fakeRoot(party); bindMarchControls(root);
  root.button.listeners.click(evt()); await settle();
  assert.equal(party.flags[MOD].partyData.followLeader, false);
  root.button.listeners.click(evt()); await settle();
  assert.equal(party.flags[MOD].partyData.followLeader, true);
  const before = writes.length;
  globalThis.game.user.isGM = false; party.testUserPermission = () => false;
  root.button.listeners.click(evt()); await settle();
  assert.equal(writes.length, before, "a viewer who cannot manage the party writes nothing");
});
test("clicking a portrait makes them lead; dragging one onto another cell swaps them; an empty cell does nothing", async () => {
  const { party, writes } = world();
  const root = fakeRoot(party); bindMarchControls(root);
  const cell = (row, col) => root.cells.find(c => c.dataset.row === String(row) && c.dataset.col === String(col));
  cell(0, 0).dataset.uuid = "Actor.b"; cell(-1, 0).dataset.uuid = "Actor.a"; cell(1, 0).dataset.uuid = "Actor.c";
  cell(0, 0).listeners.click(); await settle();
  assert.equal(party.flags[MOD].partyData.leaderUuid, "Actor.b");
  const drag = evt(); cell(1, 0).listeners.dragstart(drag);
  assert.equal(drag.dataTransfer.data, "Actor.c");
  const drop = evt({ dataTransfer: drag.dataTransfer }); cell(-1, 0).listeners.drop(drop); await settle();
  assert.equal(drop.prevented, true);
  const slots = party.flags[MOD].partyData.formation.slots;
  assert.deepEqual(slots.find(s => s.memberUuid === "Actor.c"), { memberUuid: "Actor.c", col: 0, row: -1 }, "Cato took the front");
  assert.deepEqual(slots.find(s => s.memberUuid === "Actor.a"), { memberUuid: "Actor.a", col: 0, row: 1 }, "Ayla took the cell Cato left");
  const before = writes.length;
  cell(1, 1).listeners.click(); await settle();
  assert.equal(writes.length, before, "an empty cell is not a leader");
});
test("a viewer who cannot manage the party cannot lead, drag or drop", async () => {
  const { party, writes } = world({ gm: false });
  party.testUserPermission = () => false;
  const root = fakeRoot(party); bindMarchControls(root);
  const c = root.cells[3]; c.dataset.uuid = "Actor.b";
  c.listeners.click(); const drag = evt(); c.listeners.dragstart(drag); const over = evt(); c.listeners.dragover(over); c.listeners.drop(evt());
  await settle();
  assert.equal(drag.prevented, true); assert.notEqual(over.prevented, true);
  assert.equal(writes.length, 0);
});
test("moveToSlot swaps the dragged member with whoever holds the cell, and refuses someone with no slot", () => {
  const { party } = world();
  const data = Party.data(party), rows = Party.rows(party);
  const slots = moveToSlot(data, rows, "Actor.a", 0, 0);
  assert.deepEqual(slots.map(s => [s.memberUuid, s.row]).sort(), [["Actor.a", 0], ["Actor.b", -1], ["Actor.c", 1]]);
  assert.equal(moveToSlot(data, rows, "Actor.zed", 0, 0), null);
});
