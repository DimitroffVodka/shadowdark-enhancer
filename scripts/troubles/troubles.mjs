/**
 * Shadowdark Enhancer — the Trouble tracker (#193, GMWR pp.48–49).
 *
 * Every week boundary the world clock passes runs one check, whatever moved
 * the clock: travel, camp, downtime or the GM. Trouble stirs in a real
 * settlement, picked from the imported key locations, and counts down on the
 * world clock from weeks to days to hours to happened, whispering the GM at
 * each stage. Each trouble is a GM-only page in one "Troubles" journal entry,
 * its state in the page's `trouble` flag; the page's text is written once, so
 * the GM's notes on it stay. The rules are trouble-core.mjs.
 *
 * Runs on the active GM: `timeAdvanced` fires there only (time.mjs). Every
 * write goes through one queue on this client, the automatic checks and the
 * GM's own calls alike.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { crawlEntries, knownRegions } from "../hex-map/hex-region.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";
import { regionKey } from "../rules-data/rules-data-core.mjs";
import { format as formatTime } from "../time/time.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { Quests, openQuestLog, jumpToHex } from "../quests/quests.mjs";
import * as core from "./trouble-core.mjs";
import { troubleCard } from "../shared/chat-cards.mjs";
import { L as t } from "../shared/i18n.mjs";

/** World setting: the quiet weeks since trouble last stirred. */
export const QUIET_SETTING = "troubleQuietWeeks";
/** World setting: the last week start checked, so a clock set back and moved on again doesn't check it twice. */
export const LAST_WEEK_SETTING = "troubleLastWeek";
/**
 * The most week starts one clock move checks: the last ones.
 * ponytail: a year's jump would otherwise stir a dozen troubles at once (and a
 * calendar set to year 1300, tens of thousands); a GM wanting more runs Check.
 */
const MAX_CATCH_UP = 4;
const LOG_FLAG = "troubleLog";
const TROUBLE_FLAG = "trouble";
/** The GM Guide's four tables, as the importer names them (table-shapes.mjs, gmwr/trouble-*). */
const TABLES = {
  region: "Trouble in the Reaches: Region",
  settlement: "Trouble in the Reaches: Settlement",
  type: "Type of Trouble",
  urgency: "Trouble Urgency Level",
};

const resultText = (r) => String(r?.name || r?.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const rollDie = async (formula) => (await new Roll(formula).evaluate()).total;

/** One write at a time on this client. */
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch((err) => console.error(`${MODULE_ID} | trouble tracker`, err));
  return run;
};

/** A table by name: the module's pack first, then the world's; a "<book> - " prefix is allowed. */
async function findTable(name) {
  const matches = (n) => { const s = String(n ?? "").toLowerCase(); const w = name.toLowerCase(); return s === w || s.endsWith(` - ${w}`); };
  const pack = findSuitePack("sde-tables");
  if (pack) {
    const index = pack.index?.size ? pack.index : await pack.getIndex();
    const hit = index.find((e) => matches(e.name));
    if (hit) return pack.getDocument(hit._id);
  }
  return game.tables?.find((tb) => matches(tb.name)) ?? null;
}

/** One roll's results (a nested row gives a label and its sub-table), or null with a warning naming the table to import. */
async function drawResults(name) {
  const table = await findTable(name);
  if (!table) { ui.notifications.warn(t("SDE.troubles.notify.noTable", { table: name })); return null; }
  return (await table.roll({ recursive: false })).results;
}

/**
 * Region name → its settlements, from the imported key locations. The region
 * is the crawl's title when the module knows it, else the row's own zone:
 * the rule regionSeeds follows (hex-region.mjs).
 */
async function settlementsByRegion() {
  const known = knownRegions();
  const out = new Map();
  for (const entry of await crawlEntries()) {
    const flag = entry.getFlag(MODULE_ID, HEX_FLAG);
    const crawl = String(flag.crawl ?? "").trim();
    const pages = new Map(entry.pages.map((p) => [String(p.getFlag(MODULE_ID, HEX_FLAG)?.num ?? ""), p.uuid]));
    for (const k of flag.keyed ?? []) {
      if (!core.SETTLEMENT_KINDS.includes(k.feature)) continue;
      const region = (known.has(crawl) ? crawl : String(k.zone ?? "").trim()) || crawl;
      if (!out.has(region)) out.set(region, []);
      out.get(region).push({ name: k.name, num: Number(k.num), kind: k.feature, uuid: pages.get(String(k.num)) ?? null });
    }
  }
  return out;
}

/** The type and its detail: a nested row's sub-table is drawn (#188), an inline "1d6: 1. … 2. …" list is rolled. */
async function rollType() {
  const results = await drawResults(TABLES.type);
  if (!results?.length) return null;
  const label = resultText(results.find((r) => r.type !== "document") ?? results[0]);
  const nested = results.find((r) => r.type === "document" && foundry.utils.parseUuid(r.documentUuid)?.type === "RollTable");
  if (nested) {
    const inner = await fromUuid(nested.documentUuid);
    const drawn = inner ? (await inner.roll()).results : [];
    return { type: label || String(inner?.name ?? "").replace(/^.*?:\s*/, ""), detail: drawn.map(resultText).filter(Boolean).join("; ") };
  }
  const inline = core.inlineDetail(label);
  if (!inline) return { type: label, detail: "" };
  return { type: inline.type, detail: inline.options[(await rollDie(inline.formula)) - 1] ?? "" };
}

/** Whether this world can track trouble: the four tables and the key locations imported. */
async function ready() {
  for (const name of Object.values(TABLES)) if (!(await findTable(name))) return false;
  return (await crawlEntries()).length > 0;
}

/** Seconds in an hour, a day and a week on the world's calendar. */
function calendarSecs() {
  const cal = game.time.calendar;
  const day = secondsPerDay(cal);
  return { hour: day / (cal?.days?.hoursPerDay || 24), day, week: day * (cal?.days?.values?.length || 7) };
}

const whisper = (content) => ChatMessage.create({
  content: troubleCard({ title: t("SDE.troubles.title"), html: content }),
  speaker: { alias: t("SDE.troubles.title") },
  whisper: ChatMessage.getWhisperRecipients("GM"),
});

const link = (uuid, name) => (uuid ? `@UUID[${uuid}]{${esc(name)}}` : esc(name));
const KIND_KEYS = {
  village: "SDE.troubles.kind.village", town: "SDE.troubles.kind.town",
  city: "SDE.troubles.kind.city", city_state: "SDE.troubles.kind.city_state",
};
const STAGE_KEYS = {
  weeks: "SDE.troubles.stage.weeks", days: "SDE.troubles.stage.days",
  hours: "SDE.troubles.stage.hours", happened: "SDE.troubles.stage.happened",
};
const kindLabel = (kind) => t(KIND_KEYS[kind] ?? kind);
const stageLabel = (stage) => t(STAGE_KEYS[stage] ?? stage);
/** "Monster horde: Orcs", or the type alone when it has no detail. */
const what = (tr) => (tr.detail ? t("SDE.troubles.typeDetail", { type: tr.type, detail: tr.detail }) : tr.type);

/** The page's text, written once when the trouble stirs. */
function pageContent(tr) {
  const s = tr.settlement;
  const line = (key, data) => `<p>${t(key, data)}</p>`;
  const starts = { weeks: tr.stirredAt, days: tr.daysAt, hours: tr.hoursAt, happened: tr.arriveAt };
  // From the stage the urgency roll gave (a trouble days away never was weeks
  // away), leaving out a stage the next one begins with.
  const shown = core.STAGES.slice(core.STAGES.indexOf(tr.urgency))
    .filter((stage, i, list) => i === list.length - 1 || starts[stage] < starts[list[i + 1]]);
  const stages = shown.map((stage) => `<li>${t("SDE.troubles.page.stage", {
    stage: esc(stageLabel(stage)), date: esc(formatTime(starts[stage])), symptoms: esc(tr.symptoms[stage] ?? ""),
  })}</li>`).join("");
  return [
    line("SDE.troubles.page.where", { settlement: link(s.uuid, s.name), kind: esc(kindLabel(s.kind)), hex: s.num, region: esc(tr.region) }),
    line("SDE.troubles.page.what", { what: esc(what(tr)) }),
    line("SDE.troubles.page.when", { stirred: esc(formatTime(tr.stirredAt)), arrives: esc(formatTime(tr.arriveAt)) }),
    `<ul>${stages}</ul>`,
  ].join("");
}

/** The Troubles journal entry: GM-only, found by its flag, made on first use. */
async function troubleLog({ create = false } = {}) {
  const found = game.journal.find((e) => e.getFlag(MODULE_ID, LOG_FLAG));
  if (found || !create) return found ?? null;
  return JournalEntry.create({
    name: t("SDE.troubles.logName"),
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    flags: { [MODULE_ID]: { [LOG_FLAG]: true } },
  });
}

const troublePages = (log) => (log?.pages.contents ?? []).filter((p) => p.getFlag(MODULE_ID, TROUBLE_FLAG));

/** A trouble's page by page id or uuid. */
async function pageOf(idOrUuid) {
  const log = await troubleLog();
  return log?.pages.get(idOrUuid) ?? (String(idOrUuid).includes(".") ? await fromUuid(idOrUuid) : null);
}

const view = (page) => ({ id: page.id, uuid: page.uuid, name: page.name, ...page.getFlag(MODULE_ID, TROUBLE_FLAG) });

/** The earliest stage change still ahead, so a tick of the real-time clock costs one comparison. */
let nextAt = null;

/** Move every trouble whose stage time has come, and whisper the GM each one's new stage. */
async function advance(now) {
  for (const page of troublePages(await troubleLog())) {
    const tr = page.getFlag(MODULE_ID, TROUBLE_FLAG);
    if (tr.resolved) continue;
    const stage = core.stageAt(now, tr);
    if (core.STAGES.indexOf(stage) <= core.STAGES.indexOf(tr.stage)) continue;
    await replaceModuleFlag(page, TROUBLE_FLAG, { ...tr, stage });
    await whisper(t("SDE.troubles.chat.stage", {
      settlement: link(page.uuid, tr.settlement.name), stage: esc(stageLabel(stage)), symptoms: esc(tr.symptoms[stage] ?? ""),
    }));
  }
}

/**
 * Stir a trouble: where (the region, then a settlement kind it has, then one
 * of those settlements), what, and how soon. Null, with a warning, when a
 * table or the key locations aren't imported or the region matches none.
 */
async function runStir({ region, kind, at } = {}) {
  const now = Number.isFinite(at) ? at : game.time.worldTime;
  const byRegion = await settlementsByRegion();
  if (!byRegion.size) { ui.notifications.warn(t("SDE.troubles.notify.noKeyLocations")); return null; }

  const printed = region ?? resultText((await drawResults(TABLES.region))?.[0]);
  if (!printed) return null;
  const place = [...byRegion.keys()].find((r) => regionKey(r) === regionKey(printed));
  const inRegion = byRegion.get(place) ?? [];
  if (!inRegion.length) { ui.notifications.warn(t("SDE.troubles.notify.noSettlement", { region: printed })); return null; }

  // A kind the region has none of is rerolled, as the book says. Every region
  // has a village, so the rerolls end; the cap only guards a broken table.
  let want = kind ? (core.settlementKind(kind) ?? kind) : null;
  for (let tries = 0; !inRegion.some((s) => s.kind === want); tries++) {
    if (tries > 50) { ui.notifications.warn(t("SDE.troubles.notify.noSettlement", { region: place })); return null; }
    const row = (await drawResults(TABLES.settlement))?.[0];
    if (!row) return null;
    want = core.settlementKind(resultText(row));
  }
  const choices = inRegion.filter((s) => s.kind === want);
  const settlement = choices[(await rollDie(`1d${choices.length}`)) - 1];

  const typed = await rollType();
  const urgency = await findTable(TABLES.urgency);
  if (!typed || !urgency) {
    if (!urgency) ui.notifications.warn(t("SDE.troubles.notify.noTable", { table: TABLES.urgency }));
    return null;
  }
  const rows = Object.fromEntries(urgency.results.contents
    .map((r) => core.urgencyRow(resultText(r))).filter(Boolean).map((r) => [r.stage, r]));
  const drawn = core.urgencyRow(resultText((await urgency.roll()).results[0]));
  if (!drawn) { ui.notifications.warn(t("SDE.troubles.notify.noTable", { table: TABLES.urgency })); return null; }
  const rolled = {};
  for (const stage of ["weeks", "days", "hours"]) if (rows[stage]?.formula) rolled[stage] = await rollDie(rows[stage].formula);
  const times = core.schedule(drawn.stage, now, rolled, calendarSecs());

  const trouble = {
    region: place, settlement, type: typed.type, detail: typed.detail,
    urgency: drawn.stage, rolled, stirredAt: now, ...times,
    // A trouble stirred at a week start earlier in a long clock move is
    // already further on; advance() then has nothing to say about it.
    stage: core.stageAt(Math.max(now, game.time.worldTime), times),
    symptoms: Object.fromEntries(core.STAGES.map((s) => [s, rows[s]?.symptoms ?? ""])),
    discovered: false, resolved: false, questUuid: null,
  };
  const log = await troubleLog({ create: true });
  const [page] = await log.createEmbeddedDocuments("JournalEntryPage", [{
    name: t("SDE.troubles.pageName", { settlement: settlement.name, type: typed.type }),
    type: "text",
    text: { content: pageContent(trouble) },
    flags: { [MODULE_ID]: { [TROUBLE_FLAG]: trouble } },
  }]);
  nextAt = null;
  await whisper(t("SDE.troubles.chat.stirred", {
    settlement: link(page.uuid, settlement.name), region: esc(place), what: esc(what(trouble)),
    stage: esc(stageLabel(trouble.stage)), symptoms: esc(trouble.symptoms[trouble.stage]),
  }));
  return view(page);
}

/**
 * One weekly check. A hit stirs a trouble and starts the count again; one
 * that couldn't be placed (the warning says why) keeps the count.
 */
async function runCheck({ at } = {}) {
  const now = Number.isFinite(at) ? at : game.time.worldTime;
  const quiet = game.settings.get(MODULE_ID, QUIET_SETTING);
  const d6 = await rollDie("1d6");
  const out = core.weeklyCheck(quiet, d6);
  await whisper(t(out.stirs ? "SDE.troubles.chat.stirs" : "SDE.troubles.chat.quiet",
    { date: esc(formatTime(now)), roll: d6, chance: out.chance, next: core.checkChance(out.quiet) }));
  const trouble = out.stirs ? await runStir({ at: now }) : null;
  const next = out.stirs && !trouble ? quiet : out.quiet;
  await game.settings.set(MODULE_ID, QUIET_SETTING, next);
  if (out.stirs && !trouble) await whisper(t("SDE.troubles.chat.unplaced", { chance: core.checkChance(next) }));
  return { roll: d6, chance: out.chance, stirs: out.stirs, trouble };
}

/**
 * A clock move: one check per week start it passed that hasn't been checked
 * (the last MAX_CATCH_UP of them), in a world that has what the tracker
 * needs; then any trouble whose stage time has come moves on.
 */
async function onTimeAdvanced({ from, to, crossed }) {
  if (crossed?.weeks) {
    const cal = game.time.calendar;
    const last = game.settings.get(MODULE_ID, LAST_WEEK_SETTING);
    const starts = core.weekStarts({ secondsPerDay: secondsPerDay(cal), week: cal?.days?.values?.length || 7, offset: cal?.years?.firstWeekday ?? 0 }, from, to)
      .filter((at) => !Number.isFinite(last) || at > last);
    if (starts.length) {
      if (await ready()) {
        if (starts.length > MAX_CATCH_UP) await whisper(t("SDE.troubles.chat.catchUp", { weeks: starts.length, checked: MAX_CATCH_UP }));
        for (const at of starts.slice(-MAX_CATCH_UP)) await runCheck({ at });
      }
      await game.settings.set(MODULE_ID, LAST_WEEK_SETTING, starts.at(-1));
    }
  }
  nextAt ??= Math.min(Infinity, ...troublePages(await troubleLog()).map((p) => core.nextChange(from, p.getFlag(MODULE_ID, TROUBLE_FLAG))));
  if (to >= nextAt) { await advance(to); nextAt = null; }
}

export const Troubles = {
  /**
   * The weekly check (GM), by hand: a d6 against 1-in-6 plus one per quiet week.
   * @returns {Promise<{roll:number, chance:number, stirs:boolean, trouble:object|null}|null>}
   */
  check({ at } = {}) {
    return game.user.isGM ? enqueue(() => runCheck({ at })) : Promise.resolve(null);
  },

  /**
   * Stir a trouble (GM), as a hit on the check does. `region` and `kind`
   * force the first rolls; a kind the region has none of is rerolled on the
   * Settlement table, as the book says.
   * @param {{region?:string, kind?:string, at?:number}} [opts]
   */
  stir(opts = {}) {
    return game.user.isGM ? enqueue(() => runStir(opts)) : Promise.resolve(null);
  },

  /** Every trouble, newest first (GM). */
  async list() {
    if (!game.user.isGM) return [];
    return troublePages(await troubleLog()).map(view).sort((a, b) => b.stirredAt - a.stirredAt);
  },

  /** Troubles the party hasn't heard of yet, oldest first: what the rumor generator (#190) gives first. */
  async undiscovered() {
    return (await this.list()).filter((tr) => !tr.discovered && !tr.resolved).reverse();
  },

  /** Mark a trouble heard of (GM). */
  discover(idOrUuid, discovered = true) {
    if (!game.user.isGM) return Promise.resolve(null);
    return enqueue(async () => {
      const page = await pageOf(idOrUuid);
      const tr = page?.getFlag(MODULE_ID, TROUBLE_FLAG);
      if (!tr) return null;
      await replaceModuleFlag(page, TROUBLE_FLAG, { ...tr, discovered: !!discovered });
      return view(page);
    });
  },

  /** An Available quest for the trouble (GM), linked back to its page; its quest when it has one. */
  promote(idOrUuid) {
    if (!game.user.isGM) return Promise.resolve(null);
    return enqueue(async () => {
      const page = await pageOf(idOrUuid);
      const tr = page?.getFlag(MODULE_ID, TROUBLE_FLAG);
      if (!tr) return null;
      const existing = tr.questUuid ? Quests.get(tr.questUuid) : null;
      if (existing) return existing;
      const quest = await Quests.create({
        name: page.name,
        status: "available",
        source: { kind: "trouble", uuid: page.uuid },
        description: t("SDE.troubles.questText", { settlement: tr.settlement.name, region: tr.region, type: tr.type }),
        hex: tr.settlement.num,
      });
      if (quest) await replaceModuleFlag(page, TROUBLE_FLAG, { ...tr, questUuid: quest.uuid, discovered: true });
      return quest;
    });
  },
};

/** The page's live state and the GM's buttons, above its text. */
function decoratePage(sheet, html) {
  const page = sheet.document;
  const tr = page?.getFlag?.(MODULE_ID, TROUBLE_FLAG);
  if (!tr || !game.user.isGM || !sheet.isView || html.querySelector(".sde-trouble-status")) return;
  const bar = document.createElement("div");
  bar.className = "sde-trouble-status";
  const state = tr.resolved ? t("SDE.troubles.status.resolved") : stageLabel(tr.stage);
  bar.innerHTML = `<span><strong>${esc(state)}</strong> · ${esc(t(tr.discovered ? "SDE.troubles.status.heard" : "SDE.troubles.status.unheard"))}</span>`;
  const button = (label, action) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => action().then(() => sheet.render()).catch((err) => console.error(`${MODULE_ID} | trouble page`, err)));
    bar.append(b);
  };
  if (!tr.resolved) {
    button(t(tr.discovered ? "SDE.troubles.button.unheard" : "SDE.troubles.button.heard"), () => Troubles.discover(page.id, !tr.discovered));
    button(t(tr.questUuid ? "SDE.troubles.button.openQuest" : "SDE.troubles.button.promote"),
      async () => { if (tr.questUuid) await openQuestLog(); else await Troubles.promote(page.id); });
  }
  button(t("SDE.troubles.button.pin"), () => jumpToHex(tr.settlement.num));
  html.prepend(bar);
}

/** A promoted trouble's quest completed: the trouble is resolved and its countdown stops. */
async function onQuestsChanged({ ids } = {}) {
  if (!isActiveGM()) return;
  for (const id of ids ?? []) {
    const quest = Quests.get(id);
    if (quest?.source?.kind !== "trouble" || quest.status !== "completed") continue;
    await enqueue(async () => {
      const page = await fromUuid(quest.source.uuid).catch(() => null);
      const tr = page?.getFlag(MODULE_ID, TROUBLE_FLAG);
      if (tr && !tr.resolved) await replaceModuleFlag(page, TROUBLE_FLAG, { ...tr, resolved: true });
    });
  }
}

/** The GM's "Check for trouble" button, beside the Quest Log's in the Journal sidebar. */
function addDirectoryButton(_app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!game.user.isGM || !root || root.querySelector(".sde-trouble-check")) return;
  const footer = root.querySelector(".directory-footer");
  if (!footer) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sde-trouble-check";
  btn.innerHTML = `<i class="fa-solid fa-triangle-exclamation" inert></i> <span>${esc(t("SDE.troubles.button.check"))}</span>`;
  btn.addEventListener("click", () => { Troubles.check().catch((err) => console.error(`${MODULE_ID} | trouble check`, err)); });
  footer.append(btn);
}

/** Settings, hooks and buttons. Must run in `init`, after registerQuests (it adds the footer). */
export function registerTroubles() {
  game.settings.register(MODULE_ID, QUIET_SETTING, { scope: "world", config: false, type: Number, default: 0 });
  game.settings.register(MODULE_ID, LAST_WEEK_SETTING, {
    scope: "world", config: false, type: new foundry.data.fields.NumberField({ nullable: true, initial: null }), default: null,
  });
  Hooks.on("renderJournalDirectory", addDirectoryButton);
  Hooks.on("renderJournalEntryPageSheet", decoratePage);
  Hooks.on(`${MODULE_ID}.questsChanged`, (e) => { onQuestsChanged(e).catch((err) => console.error(`${MODULE_ID} | trouble resolve`, err)); });
  for (const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
    Hooks.on(hook, (page) => { if (page.getFlag?.(MODULE_ID, TROUBLE_FLAG)) nextAt = null; });
  }
  // Queued: the real-time clock ticks every second, and a check that stirs a
  // trouble takes several awaits.
  Hooks.on(`${MODULE_ID}.timeAdvanced`, (e) => { enqueue(() => onTimeAdvanced(e)); });
}
