/**
 * Shadowdark Enhancer — the rumor generator and the Rumors Heard ledger (#190).
 *
 * The GM gives rumors: troubles the party hasn't heard of first (the Trouble
 * tracker, #193), then rows of the region's rumor table and the general
 * "Rumors in the Reaches" in turn. A row given once is never given again,
 * anywhere in the world: it is marked drawn on the imported table, which the
 * GM can reset from its sheet. Core Foundry marks nothing drawn on a table in
 * a compendium pack, and every imported table is in the module's, so the
 * generator marks the rows itself, and a GM's own roll of a rumor table is
 * marked the same way (installRumorDraws).
 *
 * The ledger is one journal entry players can read: a page per region and a
 * general page, each holding its rumors in the page's `rumorPage` flag and
 * writing its text from that flag. rumors.heard() and Shadowdark Extras'
 * party sheet read the flag. The rules are rumor-core.mjs.
 *
 * ponytail: writes are queued per client, as quests are; two GMs giving rumors
 * in the same second can each pick the same row. One ledger, found by flag.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { regionKey } from "../rules-data/rules-data-core.mjs";
import { format as formatTime } from "../time/time.mjs";
import { partyHex, hexZonesFor } from "../encounter/encounter-terrain.mjs";
import { isOverland, overlandState } from "../overland/overland.mjs";
import { Quests, openQuestLog } from "../quests/quests.mjs";
import { Troubles } from "../troubles/troubles.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import * as core from "./rumor-core.mjs";

/** `shadowdark-enhancer.rumorsChanged`, `{ ids }`: ledger pages that changed, on every client. */
export const RUMORS_CHANGED = `${MODULE_ID}.rumorsChanged`;
const LEDGER_FLAG = "rumorLedger";
const PAGE_FLAG = "rumorPage";
const MAX_COUNT = 20;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const sameRegion = (a, b) => regionKey(a) === regionKey(b);

/** One write at a time on this client. */
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch((err) => console.error(`${MODULE_ID} | rumors`, err));
  return run;
};

// ── The tables ──────────────────────────────────────────────────────────────

/**
 * Every rumor table, one per region and one general (key ""), the module's
 * pack before the world's: `{ name, region, load }`. The region is spelled as
 * the table names it.
 */
async function rumorTables() {
  const found = [];
  const pack = findSuitePack("sde-tables");
  if (pack) {
    const index = pack.index?.size ? pack.index : await pack.getIndex();
    for (const e of index) if (core.isRumorTable(e.name)) found.push({ name: e.name, load: () => pack.getDocument(e._id) });
  }
  for (const tb of game.tables ?? []) if (core.isRumorTable(tb.name)) found.push({ name: tb.name, load: async () => tb });
  const out = new Map();
  for (const f of found) {
    const region = core.rumorTableRegion(f.name);
    const key = region === null ? "" : regionKey(region);
    if (!out.has(key)) out.set(key, { ...f, region });
  }
  return out;
}

/**
 * The party's region: the travel hex's while travelling, else the party
 * token's hex on a scanned map, else the last travel hex (a town scene off the
 * map). Null when none is known.
 */
async function partyRegion() {
  if (isOverland()) return overlandState().hex?.region ?? null;
  try {
    const hex = partyHex();
    const zone = hex ? (await hexZonesFor(globalThis.canvas?.scene)).byNum.get(hex.num)?.zone : null;
    if (zone) return zone;
  } catch (err) {
    console.warn(`${MODULE_ID} | rumors: the party's region`, err);
  }
  return overlandState().hex?.region ?? null;
}

/** The characters who hear the rumors when none are named: the players' own online, else the player PCs on the active scene, else every player PC. */
function defaultHeardBy() {
  const names = (actors) => [...new Set(actors.map((a) => a.name))];
  const online = game.users.filter((u) => u.active && !u.isGM && u.character).map((u) => u.character);
  if (online.length) return names(online);
  const onScene = (game.scenes.active?.tokens ?? []).map((tk) => tk.actor)
    .filter((a) => a?.type === "Player" && a.hasPlayerOwner);
  if (onScene.length) return names(onScene);
  return names(game.actors.filter((a) => a.type === "Player" && a.hasPlayerOwner));
}

// ── The ledger ──────────────────────────────────────────────────────────────

const ledger = () => game.journal.find((e) => e.getFlag(MODULE_ID, LEDGER_FLAG)) ?? null;

const pageFlag = (page) => page.getFlag(MODULE_ID, PAGE_FLAG);
const pageFor = (log, region) => log.pages.find((p) => {
  const f = pageFlag(p);
  return f && (region ? f.region && sameRegion(f.region, region) : !f.region);
});

const realDate = (ms) => new Date(ms).toLocaleDateString(game.i18n.lang);
const listNames = (names) => new Intl.ListFormat(game.i18n.lang, { type: "conjunction" }).format(names);

/** Add rumors to their pages (a region's, or the general page), making the entry and pages first use. */
async function writeLedger(rumors) {
  const log = ledger() ?? await JournalEntry.create({
    name: t("SDE.rumors.ledgerName"),
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { [LEDGER_FLAG]: true } },
  });
  const groups = new Map();
  for (const r of rumors) {
    const key = r.region ? regionKey(r.region) : "";
    if (!groups.has(key)) groups.set(key, { region: r.region ?? null, rumors: [] });
    groups.get(key).rumors.push(r);
  }
  const create = [], update = [];
  const top = Math.max(0, ...log.pages.map((p) => p.sort));
  for (const { region, rumors: added } of groups.values()) {
    const page = pageFor(log, region);
    const all = [...(page ? pageFlag(page).rumors ?? [] : []), ...added];
    const content = core.ledgerHtml(all, t, realDate, listNames);
    if (page) {
      update.push({ _id: page.id, "text.content": content, [`flags.${MODULE_ID}.${PAGE_FLAG}`]: _replace({ region: pageFlag(page).region ?? null, rumors: all }) });
    } else {
      create.push({
        name: region ?? t("SDE.rumors.ledger.general"),
        type: "text",
        // The general page first; regions after it, in the order they are heard of.
        sort: region ? top + (create.length + 1) * CONST.SORT_INTEGER_DENSITY : 0,
        text: { content },
        flags: { [MODULE_ID]: { [PAGE_FLAG]: { region, rumors: all } } },
      });
    }
  }
  if (create.length) await log.createEmbeddedDocuments("JournalEntryPage", create);
  if (update.length) await log.updateEmbeddedDocuments("JournalEntryPage", update);
}

/** Every rumor the ledger holds from one table, for rowsLeft's re-import check. */
function givenFrom(tableName) {
  const log = ledger();
  if (!log) return [];
  return log.pages.contents.flatMap((p) => pageFlag(p)?.rumors ?? [])
    .map((r) => r.source).filter((s) => s?.table === tableName);
}

// ── Giving rumors ───────────────────────────────────────────────────────────

/**
 * Give `count` rumors (GM). Unheard troubles first, then the region's table and
 * the general one in turn. `region` undefined means the party's; null means
 * the general table only. `heardBy` names who heard them; an empty list is
 * kept. Returns the rumors given, as heard() shows them.
 *
 * Nothing is written until every rumor is picked, and then the ledger first:
 * a failure after it can only let a row come up again, never lose a rumor.
 */
async function runGive({ count = 1, region, heardBy } = {}) {
  const n = Math.min(MAX_COUNT, Math.max(1, Math.trunc(Number(count)) || 1));
  const tables = await rumorTables();
  const wanted = region === undefined ? await partyRegion() : (region || null);
  const regionalRef = wanted ? tables.get(regionKey(wanted)) ?? null : null;
  const generalRef = tables.get("") ?? null;
  if (!tables.size) ui.notifications.warn(t("SDE.rumors.notify.noTables"));
  else if (wanted && !regionalRef && generalRef) ui.notifications.warn(t("SDE.rumors.notify.noRegionTable", { region: wanted }));

  const regional = regionalRef ? await regionalRef.load() : null;
  const general = generalRef ? await generalRef.load() : null;
  for (const table of [regional, general]) {
    if (table?.compendium?.locked) { ui.notifications.warn(t("SDE.rumors.notify.locked", { table: table.name })); return null; }
  }

  const worldTime = game.time.worldTime;
  const stamp = { worldTime, gameTime: formatTime(worldTime), real: Date.now(), heardBy: heardBy ? [...heardBy] : defaultHeardBy(), questUuid: null };
  const troubles = (await Troubles.undiscovered()).slice(0, n);
  const rumors = troubles.map((tr) => ({
    id: foundry.utils.randomID(), text: core.troubleRumorText(tr, t), region: tr.region, source: { trouble: tr.uuid }, ...stamp,
  }));

  // Table rows still there to give, and those a re-import made new.
  const rowsOf = (table) => (table
    ? core.rowsLeft(table.results.contents.map((r) => ({ id: r.id, range: [...r.range], drawn: r.drawn, text: core.plainRow(r.name || r.description) })), givenFrom(table.name))
    : { available: [], stale: [] });
  const left = { regional: rowsOf(regional), general: rowsOf(general) };
  const plan = core.planDraws(n - rumors.length, { regional: left.regional.available.length, general: left.general.available.length });
  const rng = () => CONFIG.Dice.randomUniform();
  const picked = {
    regional: core.pickRows(left.regional.available, plan.filter((p) => p === "regional").length, rng),
    general: core.pickRows(left.general.available, plan.filter((p) => p === "general").length, rng),
  };
  const next = { regional: 0, general: 0 };
  for (const from of plan) {
    const row = picked[from][next[from]++];
    const table = from === "regional" ? regional : general;
    rumors.push({
      id: foundry.utils.randomID(), text: row.text, region: from === "regional" ? regionalRef.region : null,
      source: { table: table.name, resultId: row.id, range: row.range }, ...stamp,
    });
  }

  // With no tables at all, the warning above already said to import them.
  if (!rumors.length) { if (tables.size) ui.notifications.warn(t("SDE.rumors.notify.noneLeft")); return []; }
  if (rumors.length < n && tables.size) ui.notifications.warn(t("SDE.rumors.notify.short", { given: rumors.length, count: n }));

  await writeLedger(rumors);
  for (const [from, table] of [["regional", regional], ["general", general]]) {
    const ids = [...picked[from], ...left[from].stale].map((r) => r.id);
    if (table && ids.length) await table.updateEmbeddedDocuments("TableResult", ids.map((_id) => ({ _id, drawn: true })));
  }
  for (const tr of troubles) await Troubles.discover(tr.id);

  const safely = (what, fn) => Promise.resolve().then(fn).catch((err) => console.error(`${MODULE_ID} | rumors: ${what}`, err));
  await safely("recap", () => SessionRecap.logRumors(rumors.map(core.heardView)));
  await safely("chat", () => ChatMessage.create({
    content: `<div class="sde-rumor-card"><header>${esc(t("SDE.rumors.chat.title"))}</header><ul>${rumors.map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul></div>`,
    speaker: { alias: t("SDE.rumors.title") },
  }));
  return rumors.map(core.heardView);
}

/** Ask the GM how many, from where and who heard them, then give them (the crawl bar's Give rumors…). */
export async function askAndGive() {
  if (!game.user.isGM) return null;
  const tables = await rumorTables();
  const here = await partyRegion();
  const regions = [...tables.values()].map((x) => x.region).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const heard = new Set(defaultHeardBy());
  const pcs = game.actors.filter((a) => a.type === "Player" && a.hasPlayerOwner);
  const pending = (await Troubles.undiscovered()).length;
  const option = (value, label, selected) => `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
  const content = `
    <div class="form-group"><label>${esc(t("SDE.rumors.dialog.count"))}</label>
      <input type="number" name="count" min="1" max="${MAX_COUNT}" step="1" value="2" autofocus></div>
    <div class="form-group"><label>${esc(t("SDE.rumors.dialog.region"))}</label>
      <select name="region">${option("", t("SDE.rumors.dialog.generalOnly"), !here)}${regions.map((r) => option(r, r, here && sameRegion(r, here))).join("")}</select></div>
    <fieldset><legend>${esc(t("SDE.rumors.dialog.heardBy"))}</legend>
      ${pcs.map((a) => `<label class="checkbox"><input type="checkbox" name="heardBy" value="${esc(a.name)}" ${heard.has(a.name) ? "checked" : ""}> ${esc(a.name)}</label>`).join("")}</fieldset>
    ${pending ? `<p class="hint">${esc(t("SDE.rumors.dialog.troubles", { n: pending }))}</p>` : ""}`;
  const opts = await foundry.applications.api.DialogV2.prompt({
    window: { title: "SDE.rumors.dialog.title" },
    content,
    ok: {
      label: "SDE.rumors.dialog.give",
      callback: (_event, button) => ({
        count: Number(button.form.elements.count.value) || 1,
        region: button.form.elements.region.value || null,
        heardBy: [...button.form.querySelectorAll('input[name="heardBy"]:checked')].map((i) => i.value),
      }),
    },
    rejectClose: false,
  });
  return opts ? Rumors.give(opts) : null;
}

// ── Promote to quest ────────────────────────────────────────────────────────

/** The rumor's quest (GM): a trouble's through the Trouble tracker, so completing it resolves the trouble. */
function promote(pageId, rumorId) {
  return enqueue(async () => {
    const page = ledger()?.pages.get(pageId);
    const flag = page ? pageFlag(page) : null;
    const rumor = flag?.rumors?.find((r) => r.id === rumorId);
    if (!rumor) return null;
    if (rumor.questUuid && Quests.get(rumor.questUuid)) { await openQuestLog(); return Quests.get(rumor.questUuid); }
    const quest = rumor.source?.trouble
      ? await Troubles.promote(rumor.source.trouble)
      : await Quests.create({
        name: core.questName(rumor.text, t),
        status: "available",
        source: { kind: "rumor", uuid: page.uuid },
        description: rumor.text,
      });
    if (!quest) return null;
    const rumors = flag.rumors.map((r) => (r.id === rumorId ? { ...r, questUuid: quest.uuid } : r));
    await page.update({ [`flags.${MODULE_ID}.${PAGE_FLAG}`]: _replace({ ...flag, rumors }) });
    return quest;
  });
}

/** Each rumor on a ledger page gets the GM's Promote to quest (or Quest Log) button. */
function decoratePage(sheet, html) {
  const page = sheet.document;
  const flag = page?.getFlag?.(MODULE_ID, PAGE_FLAG);
  if (!flag || !game.user.isGM || !sheet.isView) return;
  const byId = new Map((flag.rumors ?? []).map((r) => [r.id, r]));
  for (const li of html.querySelectorAll("li[data-sde-rumor]")) {
    const rumor = byId.get(li.dataset.sdeRumor);
    if (!rumor || li.querySelector(".sde-rumor-promote")) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sde-rumor-promote";
    b.textContent = t(rumor.questUuid ? "SDE.rumors.button.questLog" : "SDE.rumors.button.promote");
    b.addEventListener("click", () => promote(page.id, rumor.id).catch((err) => console.error(`${MODULE_ID} | rumor promote`, err)));
    li.append(b);
  }
}

// ── Rolls from the sidebar ──────────────────────────────────────────────────

/**
 * A GM's own roll of a rumor table marks its row drawn too, so the generator
 * never gives it again: one in the module's pack (its sheet's Roll button, a
 * macro, drawMany too) or in the world (also the sidebar's Draw Result).
 * Chained over compound-table.mjs's wrap; it never changes what the draw returns.
 */
function installRumorDraws() {
  const proto = RollTable.prototype;
  if (proto._sdeRumorInstalled) return;
  // drawMany rolls without draw, so it is wrapped on its own.
  for (const method of ["draw", "drawMany"]) {
    const prev = proto[method];
    proto[method] = async function (...args) {
      const out = await prev.apply(this, args);
      try {
        // The tables rumorTables() gives from: the module's pack, or the world's.
        const eligible = this.pack ? this.pack === findSuitePack("sde-tables")?.collection && !this.compendium?.locked : true;
        if (game.user?.isGM && eligible && core.isRumorTable(this.name)) {
          const rows = core.drawnRows(this, out);
          if (rows.length) await this.updateEmbeddedDocuments("TableResult", rows.map((r) => ({ _id: r.id, drawn: true })));
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | rumors: marking a hand-rolled rumor drawn`, err);
      }
      return out;
    };
  }
  proto._sdeRumorInstalled = true;
}

// ── API and hooks ───────────────────────────────────────────────────────────

export const Rumors = {
  /**
   * Give rumors (GM). See runGive.
   * @param {{count?:number, region?:string|null, heardBy?:string[]}} [opts]
   * @returns {Promise<Array<{text:string, region:string|null, heardAt:{world:number|null, real:number}, heardBy:string[]}>|null>}
   */
  give(opts = {}) {
    if (!game.user.isGM) { ui.notifications.warn(t("SDE.rumors.notify.gmOnly")); return Promise.resolve(null); }
    return enqueue(() => runGive(opts));
  },

  /**
   * The rumors heard, newest first; `region` filters to one region's (null:
   * the general page's). Anyone may ask; never throws, and [] without a ledger.
   */
  heard(opts) {
    try {
      const region = opts?.region;
      const log = ledger();
      if (!log?.testUserPermission(game.user, "OBSERVER")) return [];
      const pages = log.pages.contents.filter((p) => p.testUserPermission(game.user, "OBSERVER")).map(pageFlag).filter(Boolean);
      return core.heardList(pages, { region, sameRegion });
    } catch (err) {
      console.warn(`${MODULE_ID} | rumors.heard`, err);
      return [];
    }
  },
};

/** Hooks and the draw wrap. Must run in `init`, after installCompoundRollTable. */
export function registerRumors() {
  installRumorDraws();
  Hooks.on("renderJournalEntryPageSheet", decoratePage);

  // One hook per burst, on every client: a give writes the entry, its pages and
  // their flags, and a listener (Extras' party sheet) should redraw once.
  const changed = new Set();
  const flush = foundry.utils.debounce(() => {
    const ids = [...changed];
    changed.clear();
    Hooks.callAll(RUMORS_CHANGED, { ids });
  }, 100);
  const note = (id) => { changed.add(id); flush(); };
  for (const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
    Hooks.on(hook, (page) => { if (page.getFlag?.(MODULE_ID, PAGE_FLAG)) note(page.id); });
  }
  Hooks.on("deleteJournalEntry", (entry) => { if (entry.getFlag?.(MODULE_ID, LEDGER_FLAG)) note(entry.id); });
}
