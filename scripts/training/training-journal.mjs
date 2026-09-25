/**
 * Regional Training — filing the 21 trainer spreads as journal entries.
 *
 * The benefits side of this feature imports as RollTables and is read from
 * there. What had no home at all is the other half of the spread: who the
 * trainer is, and the four TASKS a character must complete before any benefit
 * is on offer. Without those, picking a trainer tells a player nothing about
 * what they have to go and DO.
 *
 * Shape, following hex-commit.mjs: one JournalEntry per trainer inside a
 * folder named for its region, one text page. **Identity is the flag, never
 * the name** — `flags.shadowdark-enhancer.regionTraining = { trainer }` — so
 * re-running updates in place, a GM who renamed an entry keeps their name, and
 * nothing is ever duplicated or swept.
 *
 * COPYRIGHT: every word filed here is read out of the GM's own registered copy
 * of the Game Master's Guide at run time (source key `GMWR`). The module ships
 * the page numbers and the page's shape; it ships none of its prose. With no
 * PDF registered this reports that and files nothing.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { ensureFolderPath, ensureSuite, findSuitePack } from "../shared/compendium-suite.mjs";
import { esc } from "../shared/esc.mjs";
import { extractPdfText, notifyGutterWarnings } from "../importer/pdf-text-extract.mjs";
import { resolveSourcePdf } from "../importer/source-pdf-registry.mjs";
import { TRAINERS, trainerByKey } from "./training-core.mjs";
import { findBenefitsTable } from "./training-grant.mjs";
import { parseTrainerPage } from "./training-parser.mjs";

/** Shared with the granted Talents: one flag key for everything this feature owns. */
const TRAINING_FLAG = "regionTraining";

/** The folder the region folders live under, inside the managed journal pack. */
const ROOT_FOLDER = "Regional Training";

/** Trainers the book keys to a hex rather than to one of the fifteen regions. */
const LOOSE_FOLDER = "Elsewhere in the Reaches";

/**
 * The page body for one trainer.
 *
 * The benefits are deliberately NOT restated here. They live in the imported
 * RollTable, which is where the window reads them and where a GM edits them;
 * printing them twice would give the same four lines two sources of truth and
 * guarantee they disagree eventually. A link is offered instead, and only when
 * the table is actually present.
 */
export function trainerPageHtml(trainer, parsed, tableUuid = null) {
  const tasks = (parsed.tasks ?? []).map((task) => `<li>${esc(task)}</li>`).join("");
  return [
    `<p><em>${esc(trainer.topic)} training with ${esc(trainer.trainer)}`,
    trainer.region ? ` — ${esc(trainer.region)}` : "",
    `, pg. ${trainer.page}.</em></p>`,
    parsed.description ? `<p>${esc(parsed.description)}</p>` : "",
    tasks ? `<h3>Tasks</h3><ol>${tasks}</ol>` : "",
    `<h3>Benefits</h3>`,
    `<p>Complete a task and ${esc(trainer.trainer)} teaches one technique. `,
    `Each of the four can be learned <strong>once</strong>.</p>`,
    tableUuid
      ? `<p>@UUID[${tableUuid}]{${esc(trainer.table)}}</p>`
      : `<p><em>"${esc(trainer.table)}" is not imported yet.</em></p>`,
  ].join("");
}

/**
 * Read every trainer spread out of the GM's PDF and file it.
 *
 * @param {object}   [opts]
 * @param {string[]} [opts.only]      trainer keys to do; omit for all 21
 * @param {Function} [opts.onProgress] (done, total, trainerKey)
 * @returns {Promise<{ok:boolean, error?:string, created:number, updated:number, problems:object[]}>}
 */
export async function importTrainerJournals({ only = null, onProgress = null } = {}) {
  if (!game.user?.isGM) return { ok: false, error: "GMOnly", created: 0, updated: 0, problems: [] };

  const file = resolveSourcePdf("GMWR");
  if (!file) return { ok: false, error: "NoPdf", created: 0, updated: 0, problems: [] };

  const wanted = only?.length
    ? TRAINERS.filter((t) => only.includes(t.key))
    : TRAINERS;

  // The same find-then-create order every other importer uses: an existing
  // pack is never re-created, and ensureSuite only runs when there is none.
  const pack = findSuitePack("sde-journal") ?? (await ensureSuite())?.journal;
  if (!pack) return { ok: false, error: "NoPack", created: 0, updated: 0, problems: [] };

  // The pack's own documents, so an existing entry is found by FLAG rather
  // than by a name the GM may have changed.
  const existing = new Map();
  for (const doc of await pack.getDocuments()) {
    const key = doc.getFlag(MODULE_ID, TRAINING_FLAG)?.trainer;
    if (key) existing.set(key, doc);
  }

  let created = 0;
  let updated = 0;
  const problems = [];
  let done = 0;

  for (const trainer of wanted) {
    onProgress?.(done, wanted.length, trainer.key);
    done += 1;

    let parsed;
    try {
      const raw = await extractPdfText(file, { pages: [trainer.page], columns: "auto" });
      // A column cut the extractor was unsure of reaches the GM, as on every
      // other grab (test/pdf-grab-warnings.test.mjs).
      notifyGutterWarnings(raw);
      parsed = parseTrainerPage(typeof raw === "string" ? raw : (raw?.text ?? ""));
    }
    catch (error) {
      problems.push({ trainer: trainer.key, page: trainer.page, why: error.message });
      continue;
    }

    if (!parsed.ok) {
      problems.push({ trainer: trainer.key, page: trainer.page, why: parsed.why || "page did not parse" });
      continue;
    }
    // A short read is filed anyway — partial tasks beat none — but it is
    // reported so the GM knows to look at that page themselves.
    if (parsed.why) problems.push({ trainer: trainer.key, page: trainer.page, why: parsed.why });

    const table = await findBenefitsTable(trainer.table);
    const html = trainerPageHtml(trainer, parsed, table?.uuid ?? null);
    const name = `${trainer.topic} Training — ${trainer.trainer}`;
    const pageData = {
      name: trainer.trainer,
      type: "text",
      text: { content: html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      // The description and tasks are stored structurally beside the rendered
      // HTML so the training window can show them without re-parsing its own
      // markup — which would break the moment that markup changes.
      flags: {
        [MODULE_ID]: {
          [TRAINING_FLAG]: {
            trainer: trainer.key,
            page: trainer.page,
            description: parsed.description,
            tasks: parsed.tasks,
          },
        },
      },
    };

    const doc = existing.get(trainer.key);
    if (doc) {
      // Update the page this feature owns, by its own flag. Any other page a
      // GM added to the entry is left exactly as it is.
      // Prefer the page carrying our flag. Falling back to a lone page and
      // ADOPTING it is what stops a re-run growing a second page every time:
      // an entry whose flag went missing for any reason must be re-flagged,
      // not duplicated. Only ever a single page — an entry the GM has added
      // their own pages to is left alone and gets ours appended instead.
      const mine = doc.pages.find((p) => p.getFlag(MODULE_ID, TRAINING_FLAG)?.trainer === trainer.key)
        ?? (doc.pages.size === 1 ? doc.pages.contents[0] : null);
      if (mine) {
        // ONE update, content and flag together. Two sequential writes to a
        // compendium-embedded page is the bug this replaced: `update()` then a
        // second write through the stale reference left the flag namespace
        // EMPTY — the delete half landed and the set half did not. The tasks
        // vanished from all 21 pages that way on the first re-run.
        //
        // A dotted flag path on an ordinary (recursive) update is safe here —
        // the sibling-eating hazard module-flags.mjs guards against is
        // `recursive: false`, which this is not. The value is a fixed-shape
        // object and Foundry replaces arrays wholesale, so a merge is a
        // replace for this flag.
        await mine.update({
          "text.content": html,
          [`flags.${MODULE_ID}.${TRAINING_FLAG}`]: pageData.flags[MODULE_ID][TRAINING_FLAG],
        });
      }
      else await doc.createEmbeddedDocuments("JournalEntryPage", [pageData]);
      updated += 1;
      continue;
    }

    const folder = await ensureFolderPath(pack, [ROOT_FOLDER, trainer.region ?? LOOSE_FOLDER]);
    await JournalEntry.create({
      name,
      folder,
      pages: [pageData],
      flags: { [MODULE_ID]: { [TRAINING_FLAG]: { trainer: trainer.key, page: trainer.page } } },
    }, { pack: pack.collection });
    created += 1;
  }

  onProgress?.(done, wanted.length, null);
  return { ok: true, created, updated, problems };
}

/** The filed entry for one trainer, or null. Found by flag, not by name. */
export async function trainerJournal(trainerKey) {
  if (!trainerByKey(trainerKey)) return null;
  const pack = findSuitePack("sde-journal");
  if (!pack) return null;
  for (const doc of await pack.getDocuments()) {
    if (doc.getFlag(MODULE_ID, TRAINING_FLAG)?.trainer === trainerKey) return doc;
  }
  return null;
}
