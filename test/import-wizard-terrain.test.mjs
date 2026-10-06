/**
 * The wizard's Terrain page: the Legend of each hex map the run set up, one map at a time. The Legend itself is a stand-in
 * (hex-legend-session.mjs is the real one); what is tested is the flow around it: when the page appears, what a card's
 * answer does, a card that opens up, applying, skipping, a map that cannot be read, and what the Done page then says.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";

const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;
const HEX = (id, over = {}) => ({ id, title: `Map ${id}`, status: "ready", legend: true, look: false, sceneId: `s-${id}`, pinned: 10, ...over });

/** A Legend that records what it is told. `opens` makes answering that card ask for a redraw, `applies` is what apply() says. */
const fakeLegend = ({ opens = null, applies = true, cards = [{ idx: 0, size: 40, thumbs: [], terrainOptions: [] }] } = {}) => {
  const log = { answers: [], picks: [], applied: 0, closed: 0 };
  return { log, cards: () => cards,
    answer(idx, value, other) { log.answers.push([idx, value, other]); return idx === opens; },
    pick(idx, num, value, other) { log.picks.push([idx, num, value, other]); },
    apply: async () => { log.applied += 1; return typeof applies === "function" ? applies(log.applied) : applies; },
    close() { log.closed += 1; } };
};

/** A controller whose run has finished with these hex results, sitting on the page after the import. */
async function afterRun(hex, { legends = {}, openFails = [], steps = [] } = {}) {
  const opened = [];
  const ctl = new WizardController({
    t, release: async () => {},
    run: async () => ({ imported: 1, already: 0, needsYou: [], hex }),
    legendOpen: async (m, onProgress) => { opened.push(m); for (const text of steps) onProgress?.(text); if (openFails.includes(m.id)) throw new Error("the map would not load"); return (legends[m.id] ??= fakeLegend()); },
  }, () => {});
  ctl.state.page = "ready"; ctl.state.check = { done: true, ready: [], problems: [], items: [] };
  await ctl.dispatch("next");
  return { ctl, opened };
}

test("a run that set up no hex map goes straight to Done, and one whose maps are already named does too", async () => {
  assert.equal((await afterRun([])).ctl.state.page, "done");
  assert.equal((await afterRun([HEX("hex-cs1", { legend: false })])).ctl.state.page, "done");
});

test("a run with hex maps still to name opens the Terrain page on the first, asking for its cards", async () => {
  const { ctl, opened } = await afterRun([HEX("hex-cs1"), HEX("hex-cs2", { legend: false }), HEX("hex-cs3")]);
  assert.equal(ctl.state.page, "terrain");
  assert.deepEqual(opened.map((m) => m.id), ["hex-cs1"]);
  assert.deepEqual(opened[0], { id: "hex-cs1", title: "Map hex-cs1", sceneId: "s-hex-cs1" });
  const vm = ctl.viewModel();
  assert.match(vm.terrain.heading, /"n":1,"of":2/, "two maps are waiting: the named one is not among them");
  assert.equal(vm.terrain.cards.length, 1);
  assert.equal(vm.terrain.reading, false);
  assert.match(vm.foot.next.label, /terrain\.apply/);
  assert.match(vm.foot.cancel, /terrain\.skip/);
  assert.equal(vm.foot.back, false, "there is no going back to an import that has happened");
});

test("a card's name goes to the Legend as it is given, and only a card that opens up redraws the page", async () => {
  const legend = fakeLegend({ opens: 3 });
  const { ctl } = await afterRun([HEX("hex-cs1")], { legends: { "hex-cs1": legend } });
  let redraws = 0; ctl.onChange = () => { redraws += 1; };
  await ctl.dispatch("legendAnswer", { idx: "1", value: "forest", other: "" });
  await ctl.dispatch("legendAnswer", { idx: "2", value: "__other", other: "bog" });
  assert.equal(redraws, 0, "naming a card must not redraw: the page would lose a half-typed name");
  await ctl.dispatch("legendAnswer", { idx: "3", value: "__split", other: "" });
  assert.equal(redraws, 1, "the card that opened up needs its hexes drawn");
  await ctl.dispatch("legendPick", { idx: "3", num: "104", value: "hills", other: "" });
  assert.deepEqual(legend.log.answers, [[1, "forest", ""], [2, "__other", "bog"], [3, "__split", ""]]);
  assert.deepEqual(legend.log.picks, [[3, 104, "hills", ""]]);
});

test("Apply names the map and moves to the next one; the last one ends on Done with its status", async () => {
  const a = fakeLegend(), b = fakeLegend();
  const { ctl, opened } = await afterRun([HEX("hex-cs1"), HEX("hex-cs2")], { legends: { "hex-cs1": a, "hex-cs2": b } });
  await ctl.dispatch("next");
  assert.equal(a.log.applied, 1);
  assert.equal(a.log.closed, 1, "a finished map's reading is let go before the next is read");
  assert.equal(ctl.state.page, "terrain");
  assert.deepEqual(opened.map((m) => m.id), ["hex-cs1", "hex-cs2"]);
  assert.match(ctl.viewModel().terrain.heading, /"n":2/);
  await ctl.dispatch("next");
  assert.equal(ctl.state.page, "done");
  const done = ctl.viewModel().done;
  assert.deepEqual(done.hexMaps.map((h) => [h.id, !!h.legend]), [["hex-cs1", false], ["hex-cs2", false]]);
  assert.match(done.hexMaps[0].line, /hexStatus\.named/);
  assert.equal(done.hexLegend, false, "nothing is left to name, so the Done page does not say to");
});

test("a card still in question, or a refusal, keeps the page and its answers; a second Apply can go through", async () => {
  const legend = fakeLegend({ applies: (n) => n > 1 });
  const { ctl } = await afterRun([HEX("hex-cs1")], { legends: { "hex-cs1": legend } });
  await ctl.dispatch("next");
  assert.equal(ctl.state.page, "terrain");
  assert.equal(ctl.state.terrain.stage, "cards", "back to the cards, not stuck on applying");
  assert.equal(legend.log.closed, 0);
  await ctl.dispatch("next");
  assert.equal(ctl.state.page, "done");
});

test("Skip leaves a map's terrain for the Hex Tagger: Done still offers it", async () => {
  const { ctl } = await afterRun([HEX("hex-cs1"), HEX("hex-cs2")]);
  await ctl.dispatch("cancel");     // the footer's Skip this map
  assert.match(ctl.viewModel().terrain.heading, /"n":2/);
  await ctl.dispatch("cancel");
  assert.equal(ctl.state.page, "done");
  const done = ctl.viewModel().done;
  assert.deepEqual(done.hexMaps.map((h) => !!h.legend), [true, true]);
  assert.equal(done.hexLegend, true);
});

test("a map that cannot be read says so, offers Continue only, and does not stop the others", async () => {
  const { ctl, opened } = await afterRun([HEX("hex-cs1"), HEX("hex-cs2")], { openFails: ["hex-cs1"] });
  const vm = ctl.viewModel();
  assert.equal(vm.terrain.failed, true);
  assert.match(vm.terrain.error, /would not load/);
  assert.deepEqual(vm.terrain.cards, []);
  assert.match(vm.foot.next.label, /terrain\.continue/);
  assert.equal(vm.foot.cancel, null);
  await ctl.dispatch("next");     // Continue
  assert.deepEqual(opened.map((m) => m.id), ["hex-cs1", "hex-cs2"]);
  assert.equal(ctl.viewModel().terrain.failed, false);
});

test("while a map is being read or applied, Apply is off and says why", async () => {
  const { ctl } = await afterRun([HEX("hex-cs1")]);
  ctl.state.terrain.stage = "reading";
  let foot = ctl.viewModel().foot.next;
  assert.equal(foot.disabled, true);
  assert.match(foot.reason, /terrain\.wait/);
  ctl.state.terrain.stage = "applying";
  assert.equal(ctl.viewModel().foot.next.disabled, true);
  ctl.state.terrain.stage = "cards";
  foot = ctl.viewModel().foot.next;
  assert.equal(foot.disabled, false);
  assert.equal(foot.reason, "");
});

test("closing the wizard lets the current Legend go", async () => {
  const legend = fakeLegend();
  const { ctl } = await afterRun([HEX("hex-cs1")], { legends: { "hex-cs1": legend } });
  ctl.state.page = "done";
  await ctl.dispatch("next");     // Finish
  assert.equal(legend.log.closed, 1);
});

test("what the engine reports while it reads the map shows on the page as it goes, and is gone once the cards are", async () => {
  const { ctl } = await afterRun([HEX("hex-cs1")], { steps: ["Reading the map image…", "Reading cells 200 of 4736…"] });
  // the steps were told before the cards came; the page keeps the last one until Apply or the next map clears it
  assert.equal(ctl.state.terrain.progress, "Reading cells 200 of 4736…");
  ctl.state.terrain.stage = "reading";
  ctl.state.terrain.progress = "Sorting cells by glyph… pass 1 of 3, step 4";
  assert.equal(ctl.viewModel().terrain.progress, "Sorting cells by glyph… pass 1 of 3, step 4");
  ctl.state.terrain.stage = "cards";
  await ctl.dispatch("next");
  assert.equal(ctl.state.page, "done");
  assert.equal(ctl.state.terrain.progress, "", "Apply's own progress is cleared when it finishes");
});

test("progress during Apply is shown on the page (classifying done of total) and each map starts with none", async () => {
  const a = fakeLegend();
  const opened = [];
  const ctl = new WizardController({
    t, release: async () => {},
    run: async () => ({ imported: 0, already: 0, needsYou: [], hex: [HEX("hex-cs1"), HEX("hex-cs2")] }),
    legendOpen: async (m, onProgress) => { opened.push(onProgress); onProgress(`reading ${m.id}`); return a; },
  }, () => {});
  ctl.state.page = "ready"; ctl.state.check = { done: true, ready: [], problems: [], items: [] };
  await ctl.dispatch("next");
  const during = [];
  a.apply = async () => { opened[0]("Classifying 100 of 178…"); during.push(ctl.viewModel().terrain.progress); return true; };
  await ctl.dispatch("next");
  assert.deepEqual(during, ["Classifying 100 of 178…"]);
  assert.match(ctl.viewModel().terrain.heading, /"n":2/);
  assert.equal(ctl.viewModel().terrain.progress, "reading hex-cs2", "the second map shows its own reading, not the last map's classifying");
});

test("while Apply works the cards stay on the page (the engine empties its own list) and the footer says what it is doing", async () => {
  const live = fakeLegend();
  const shown = live.cards();
  let during;
  const { ctl } = await afterRun([HEX("hex-cs1"), HEX("hex-cs2")], { legends: { "hex-cs1": live } });
  live.cards = () => (during ? [] : shown);          // once Apply has taken the names the engine's list is gone
  live.apply = async () => {
    during = true;
    const vm = ctl.viewModel();
    ctl.state.terrain.progress = "Classifying 400 of 4466…";
    live.snapshot = { cards: vm.terrain.cards.length, applying: vm.terrain.applying, status: ctl.viewModel().foot.status, next: vm.foot.next.disabled };
    return true;
  };
  await ctl.dispatch("next");
  assert.deepEqual(live.snapshot, { cards: shown.length, applying: true, status: "Classifying 400 of 4466…", next: true });
});

test("before the engine has said anything, the footer's wait says what is happening in words", async () => {
  const live = fakeLegend();
  const { ctl } = await afterRun([HEX("hex-cs1"), HEX("hex-cs2")], { legends: { "hex-cs1": live } });
  let status;
  live.apply = async () => { status = ctl.viewModel().foot.status; return true; };
  await ctl.dispatch("next");
  assert.match(status, /terrain\.applying/);
  assert.equal(ctl.viewModel().foot.status, "", "and nothing once the next map is being read");
});
