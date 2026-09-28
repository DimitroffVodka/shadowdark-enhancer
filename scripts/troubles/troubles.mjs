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
 * Runs on the active GM: `timeAdvanced` fires there only (time.mjs).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { crawlEntries } from "../hex-map/hex-region.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";
import { format as formatTime } from "../time/time.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { Quests } from "../quests/quests.mjs";
import * as core from "./trouble-core.mjs";

/** World setting: the quiet weeks since trouble last stirred. */
export const QUIET_SETTING = "troubleQuietWeeks";
const LOG_FLAG = "troubleLog";
const TROUBLE_FLAG = "trouble";
/** The GM Guide's four tables, as the importer names them (table-shapes.mjs, gmwr/trouble-*). */
const TABLES = {
  region: "Trouble in the Reaches: Region",
  settlement: "Trouble in the Reaches: Settlement",
  type: "Type of Trouble",
  urgency: "Trouble Urgency Level",
};

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const resultText = (r) => String(r?.name || r?.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const rollDie = async (formula) => (await new Roll(formula).evaluate()).total;

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

/** One row of a table, or null with a warning naming the table to import. */
async function drawRow(name) {
  const table = await findTable(name);
  if (!table) { ui.notifications.warn(t("SDE.troubles.notify.noTable", { table: name })); return null; }
  return (await table.roll({ recursive: false })).results[0] ?? null;
}

/** Region name → its settlements, from the imported key locations. */
async function settlementsByRegion() {
  const out = new Map();
  for (const entry of await crawlEntries()) {
    const flag = entry.getFlag(MODULE_ID, HEX_FLAG);
    const pages = new Map(entry.pages.map((p) => [String(p.getFlag(MODULE_ID, HEX_FLAG)?.num ?? ""), p.uuid]));
    out.set(flag.crawl, (flag.keyed ?? [])
      .filter((k) => core.SETTLEMENT_KINDS.includes(k.feature))
      .map((k) => ({ name: k.name, num: Number(k.num), kind: k.feature, uuid: pages.get(String(k.num)) ?? null })));
  }
  return out;
}

/** The type and its detail: a nested sub-table (#188) is drawn, an inline "1d6: 1. … 2. …" list is rolled. */
async function rollType() {
  const row = await drawRow(TABLES.type);
  if (!row) return null;
  if (row.type === "document" && foundry.utils.parseUuid(row.documentUuid)?.type === "RollTable") {
    const inner = await fromUuid(row.documentUuid);
    const results = inner ? (await inner.roll()).results : [];
    return { type: resultText(row) || String(inner?.name ?? "").replace(/^.*?:\s*/, ""), detail: results.map(resultText).filter(Boolean).join("; ") };
  }
  const text = resultText(row);
  const inline = core.inlineDetail(text);
  if (!inline) return { type: text, detail: "" };
  return { type: inline.type, detail: inline.options[(await rollDie(inline.formula)) - 1] ?? "" };
}

/** Seconds in an hour, a day and a week on the world's calendar. */
function calendarSecs() {
  const cal = game.time.calendar;
  const day = secondsPerDay(cal);
  return { hour: day / (cal?.days?.hoursPerDay || 24), day, week: day * (cal?.days?.values?.length || 7) };
}

const whisper = (content) => ChatMessage.create({
  content: `<div class="sde-trouble-card">${content}</div>`,
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

/** The page's text, written once when the trouble stirs. */
function pageContent(tr) {
  const s = tr.settlement;
  const line = (key, data) => `<p>${t(key, data)}</p>`;
  const stages = core.STAGES.map((stage) => {
    const at = { weeks: tr.stirredAt, days: tr.daysAt, hours: tr.hoursAt, happened: tr.arriveAt }[stage];
    return `<li><strong>${esc(stageLabel(stage))}</strong> (${esc(formatTime(at))}): ${esc(tr.symptoms[stage] ?? "")}</li>`;
  }).join("");
  return [
    line("SDE.troubles.page.where", { settlement: link(s.uuid, s.name), kind: esc(kindLabel(s.kind)), hex: s.num, region: esc(tr.region) }),
    line("SDE.troubles.page.what", { type: esc(tr.type), detail: esc(tr.detail || "—") }),
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

export const Troubles = {
  /**
   * The weekly check (GM): a d6 against 1-in-6 plus one per quiet week. A hit
   * stirs a trouble and starts the count again. `at` is the week start it
   * stands for; now by default.
   * @returns {Promise<{roll:number, chance:number, stirs:boolean, trouble:object|null}|null>}
   */
  async check({ at } = {}) {
    if (!game.user.isGM) return null;
    const d6 = await rollDie("1d6");
    const out = core.weeklyCheck(game.settings.get(MODULE_ID, QUIET_SETTING), d6);
    await game.settings.set(MODULE_ID, QUIET_SETTING, out.quiet);
    await whisper(t(out.stirs ? "SDE.troubles.chat.stirs" : "SDE.troubles.chat.quiet",
      { roll: d6, chance: out.chance, next: core.checkChance(out.quiet) }));
    const trouble = out.stirs ? await this.stir({ at }) : null;
    return { roll: d6, chance: out.chance, stirs: out.stirs, trouble };
  },

  /**
   * Stir a trouble (GM), as a hit on the check does. `region` and `kind`
   * force the first rolls; a kind the region has none of is rerolled on the
   * Settlement table, as the book says. Null, with a warning, when a table or
   * the key locations aren't imported.
   * @param {{region?:string, kind?:string, at?:number}} [opts]
   */
  async stir({ region, kind, at } = {}) {
    if (!game.user.isGM) return null;
    const now = Number.isFinite(at) ? at : game.time.worldTime;
    const byRegion = await settlementsByRegion();
    if (!byRegion.size) { ui.notifications.warn(t("SDE.troubles.notify.noKeyLocations")); return null; }

    const printed = region ?? resultText(await drawRow(TABLES.region));
    if (!printed) return null;
    const place = core.matchRegion(printed, [...byRegion.keys()]);
    const inRegion = byRegion.get(place) ?? [];
    if (!inRegion.length) { ui.notifications.warn(t("SDE.troubles.notify.noSettlement", { region: printed })); return null; }

    // Every region has a village, so the rerolls end; the cap only guards a broken table.
    let want = kind ? (core.settlementKind(kind) ?? kind) : null;
    for (let tries = 0; !inRegion.some((s) => s.kind === want); tries++) {
      if (tries > 50) { ui.notifications.warn(t("SDE.troubles.notify.noSettlement", { region: place })); return null; }
      const row = await drawRow(TABLES.settlement);
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
      settlement: link(page.uuid, settlement.name), region: esc(place), type: esc(typed.type),
      detail: esc(typed.detail || "—"), stage: esc(stageLabel(trouble.stage)), symptoms: esc(trouble.symptoms[trouble.stage]),
    }));
    return view(page);
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
  async discover(idOrUuid, discovered = true) {
    const page = game.user.isGM ? await pageOf(idOrUuid) : null;
    const tr = page?.getFlag(MODULE_ID, TROUBLE_FLAG);
    if (!tr) return null;
    await replaceModuleFlag(page, TROUBLE_FLAG, { ...tr, discovered: !!discovered });
    return view(page);
  },

  /** An Available quest for the trouble (GM), linked back to its page; its quest when it has one. */
  async promote(idOrUuid) {
    const page = game.user.isGM ? await pageOf(idOrUuid) : null;
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
  bar.innerHTML = `<p><strong>${esc(state)}</strong> · ${esc(t(tr.discovered ? "SDE.troubles.status.heard" : "SDE.troubles.status.unheard"))}</p>`;
  const button = (label, action) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", async () => { await action(); sheet.render(); });
    bar.append(b);
  };
  if (!tr.resolved) {
    button(t(tr.discovered ? "SDE.troubles.button.unheard" : "SDE.troubles.button.heard"), () => Troubles.discover(page.id, !tr.discovered));
    button(t(tr.questUuid ? "SDE.troubles.button.openQuest" : "SDE.troubles.button.promote"), async () => {
      const quest = await Troubles.promote(page.id);
      if (quest && tr.questUuid) (await fromUuid(quest.uuid))?.sheet?.render(true);
    });
  }
  html.prepend(bar);
}

/** A promoted trouble's quest completed: the trouble is resolved and its countdown stops. */
async function onQuestsChanged({ ids } = {}) {
  if (!isActiveGM()) return;
  for (const id of ids ?? []) {
    const quest = Quests.get(id);
    if (quest?.source?.kind !== "trouble" || quest.status !== "completed") continue;
    const page = await fromUuid(quest.source.uuid).catch(() => null);
    const tr = page?.getFlag(MODULE_ID, TROUBLE_FLAG);
    if (tr && !tr.resolved) await replaceModuleFlag(page, TROUBLE_FLAG, { ...tr, resolved: true });
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
  btn.addEventListener("click", () => Troubles.check());
  footer.append(btn);
}

/** Setting, hooks and buttons. Must run in `init`, after registerQuests (it adds the footer). */
export function registerTroubles() {
  game.settings.register(MODULE_ID, QUIET_SETTING, { scope: "world", config: false, type: Number, default: 0 });
  Hooks.on("renderJournalDirectory", addDirectoryButton);
  Hooks.on("renderJournalEntryPageSheet", decoratePage);
  Hooks.on(`${MODULE_ID}.questsChanged`, (e) => { onQuestsChanged(e).catch((err) => console.error(`${MODULE_ID} | trouble resolve`, err)); });
  for (const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
    Hooks.on(hook, (page) => { if (page.getFlag?.(MODULE_ID, TROUBLE_FLAG)) nextAt = null; });
  }

  // One jump at a time: the real-time clock ticks every second, and a check
  // that stirs a trouble takes several awaits.
  let queue = Promise.resolve();
  Hooks.on(`${MODULE_ID}.timeAdvanced`, ({ from, to, crossed }) => {
    queue = queue.then(async () => {
      if (crossed?.weeks) {
        const cal = game.time.calendar;
        const starts = core.weekStarts({ secondsPerDay: secondsPerDay(cal), week: cal?.days?.values?.length || 7, offset: cal?.years?.firstWeekday ?? 0 }, from, to);
        for (const at of starts) await Troubles.check({ at });
      }
      nextAt ??= Math.min(Infinity, ...troublePages(await troubleLog()).map((p) => core.nextChange(from, p.getFlag(MODULE_ID, TROUBLE_FLAG))));
      if (to >= nextAt) { await advance(to); nextAt = null; }
    }).catch((err) => console.error(`${MODULE_ID} | trouble tracker`, err));
  });
}
