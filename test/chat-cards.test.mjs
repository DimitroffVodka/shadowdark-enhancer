import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chaosCard, pulpCard, rumorsCard, troubleCard, rulesNoticeCard, weatherCard, downtimeAnnounceCard,
  purchaseCard, compactCard, warbandNote, pitTwistCard,
} from "../scripts/shared/chat-cards.mjs";

const tpl = (name) => readFileSync(new URL(`../templates/chat/${name}.hbs`, import.meta.url), "utf8");
const buttons = (html) => [...html.matchAll(/<button\b/g)].length;

test("every card is a kit card root", () => {
  const cards = [
    chaosCard({ title: "t", rows: [] }), pulpCard({ title: "t", rows: [] }), rumorsCard({ title: "t", rumors: [] }),
    troubleCard({ title: "t", html: "x" }), rulesNoticeCard({ text: "x", button: "b" }), weatherCard({ title: "t", text: "x", fine: "f" }),
    downtimeAnnounceCard({ title: "t", announce: "a", book: "b", days: "d", open: "o", foot: "f" }),
    purchaseCard({ title: "t", buyer: "b", img: "i.png", name: "n", html: "h" }), compactCard({ icon: "skull", html: "x" }),
    warbandNote({ text: "x" }), pitTwistCard({ title: "t", text: "x" }),
  ];
  for (const html of cards) assert.match(html, /^<div class="sde-ui ui-cc[ "]/);
});

test("chaos card lists the order with rank, name, formula and total, escaped", () => {
  const html = chaosCard({ title: "Round 2", rows: [{ name: "<b>Aldric</b>", total: 17, formula: "1d20 + 2" }, { name: "Goblin", total: 9, formula: "1d20" }] });
  assert.match(html, /<h4 class="cc-title">Round 2<\/h4>/);
  assert.match(html, /<span class="cc-rank">2<\/span><span class="cc-who">Goblin<\/span>/);
  assert.match(html, /&lt;b&gt;Aldric&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /<span class="cc-num">17<\/span>/);
});

test("pulp and rumor cards carry every row", () => {
  assert.equal([...pulpCard({ title: "Luck", rows: [{ name: "A", total: 3 }, { name: "B", total: 1 }] }).matchAll(/class="cc-li"/g)].length, 2);
  const rumors = rumorsCard({ title: "Rumors", rumors: ["one", "two & three"] });
  assert.equal([...rumors.matchAll(/class="cc-li quote"/g)].length, 2);
  assert.match(rumors, /two &amp; three/);
});

test("the rules notice keeps one button, its card class and the only button the wiring queries", () => {
  const html = rulesNoticeCard({ text: "Import it", button: "Open" });
  assert.match(html, /sde-rules-notice/);
  assert.equal(buttons(html), 1);
  assert.match(html, /<button type="button" class="ui-btn">/);
});

test("the downtime announcement keeps the open button hook", () => {
  const html = downtimeAnnounceCard({ title: "Downtime", announce: "a", book: "Guide", days: "9 days", open: "Open", foot: "f" });
  assert.equal(buttons(html), 1);
  assert.match(html, /class="ui-btn primary sde-dt-open-btn"/);
  assert.match(html, /Guide/);
});

test("the warband note keeps the marker class the hook checks before adding it", () => {
  assert.match(warbandNote({ text: "Area" }), /class="cc-note info sde-warband-note"/);
});

test("trouble, purchase and compact cards pass the caller's escaped markup through", () => {
  assert.match(troubleCard({ title: "Troubles", html: "<a>Marrowgate</a>" }), /<p class="cc-text"><a>Marrowgate<\/a><\/p>/);
  assert.match(purchaseCard({ title: "Bought", buyer: "A", img: "x.png", name: "Sword", html: "<strong>A</strong> bought" }), /<small><strong>A<\/strong> bought<\/small>/);
  const parry = compactCard({ icon: "shield-halved", tone: "good", html: "Parried", aux: "Reversed 4" });
  assert.match(parry, /ui-cc compact good/);
  assert.match(parry, /<span class="cc-aux">Reversed 4<\/span>/);
  assert.match(compactCard({ big: 14, html: "x" }), /<span class="cc-big">14<\/span>/);
});

test("pit twist shows the sub line only when there is one", () => {
  assert.doesNotMatch(pitTwistCard({ title: "A Twist", text: "oil" }), /cc-fine/);
  assert.match(pitTwistCard({ title: "A Twist", text: "oil", sub: "1d4: 3" }), /<p class="cc-fine">1d4: 3<\/p>/);
});

test("loot card template keeps every action hook and its item index", () => {
  const src = tpl("loot-card");
  for (const cls of ["sde-loot-claim", "sde-loot-give", "sde-loot-forge", "sde-loot-claim-coins", "sde-loot-assign-coins", "sde-loot-coins-actor", "sde-loot-gm"]) {
    assert.ok(src.includes(cls), cls);
  }
  assert.equal([...src.matchAll(/class="ui-btn sde-loot-(claim|give|forge)" data-item-index="\{\{it\.idx\}\}"/g)].length, 3);
  assert.match(src, /<li class="cc-item" data-item-index="\{\{it\.idx\}\}">/);
  assert.match(src, /SDE\.loot\.card\.more/);
});

test("encounter card templates keep the context they render", () => {
  const check = tpl("encounter-check");
  for (const key of ["roll.total", "flavor", "where"]) assert.ok(check.includes(`{{${key}}}`), key);
  const result = tpl("encounter-result");
  for (const key of ["img", "count", "name", "distanceText", "distanceRoll", "activityText", "activityRoll", "reactionText", "reactionRoll", "chaMod"]) {
    assert.ok(result.includes(`{{${key}}}`), key);
  }
  assert.ok(result.includes("cc-react-{{reactionBand}}"));
  assert.ok(tpl("encounter-flavor").includes("{{text}}"));
});

test("the weather card keeps its marker class", () => {
  assert.match(weatherCard({ title: "t", text: "x", fine: "f" }), /ui-cc sde-weather-card/);
});
