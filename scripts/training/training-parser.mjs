/**
 * Regional Training — reading a trainer spread out of the GM's own PDF.
 *
 * COPYRIGHT: no book text lives here or anywhere else in the repo. This file
 * knows the SHAPE of a trainer page, nothing it says. The words come from the
 * GM's registered copy of the Game Master's Guide at import time, exactly like
 * every other importer path in this module.
 *
 * ── What a trainer page looks like once columns are split ─────────────────
 * `extractPdfText` with `columns: "auto"` reorders the two-column spread into
 * one stream, and every one of the twenty-one pages comes out in this order
 * (verified against all 21, not sampled):
 *
 *     Obe-Ixx is the first vampire to        ← description, wrapped
 *     ...
 *     TASKS
 *     1. Bring Obe-Ixx a bowl of fresh       ← four tasks, each wrapped
 *     blood from a creature type she
 *     2. Utterly destroy everything
 *     ...
 *     246                                    ← the PAGE NUMBER lands here
 *     Ancient Ritual Training With           ← the display title sorts LATE
 *     Obe-Ixx
 *     BENEFITS
 *     If you complete a task, ...            ← the connective rule
 *     BENEFITS
 *     d4 Benefit                             ← the benefits table, which the
 *     ...                                      importer already files as a
 *                                              RollTable — not re-read here
 *
 * Three things about that are load-bearing and none of them are guesses:
 *
 *   1. The title sorts AFTER the tasks, not before the description. Taking
 *      "everything before TASKS" as the description is therefore correct, and
 *      looking for the title first would find nothing.
 *   2. A bare page number can appear INSIDE the task block (line 26 above), so
 *      the task scan has to stop on one rather than glue it to task 4.
 *   3. The benefits are deliberately NOT parsed here. They already import as a
 *      RollTable and training-grant.mjs reads them from there; parsing them a
 *      second time would give two sources of truth for the same four lines.
 *
 * Pure: no Foundry globals, no I/O. The caller supplies the extracted text.
 */

/** A line that is nothing but a page number. */
const isPageNumber = (line) => /^\d{1,3}$/.test(line);

/** The display title, which sorts after the tasks — "<Topic> Training With". */
const isTitleLine = (line) => /Training With$|^With$/.test(line);

/** A section caption. The book prints these in caps on their own line. */
const isCaption = (line) => /^(TASKS|BENEFITS)$/.test(line);

/** The first line of a numbered task: "1. Bring Obe-Ixx a bowl of fresh". */
const TASK_START = /^([1-4])\.\s+(.*)$/;

/**
 * Parse one trainer spread.
 *
 * @param {string} text  the page, already column-split by extractPdfText
 * @returns {{description:string, tasks:string[], ok:boolean, why:string}}
 *   `ok` is false when the page does not look like a trainer spread at all, so
 *   a caller pointed at the wrong page reports that instead of filing an empty
 *   journal entry. A page that yields fewer than four tasks still returns what
 *   it found — a short read is worth showing, and `why` says it is short.
 */
export function parseTrainerPage(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const tasksAt = lines.findIndex((l) => l === "TASKS");
  if (tasksAt < 0) return { description: "", tasks: [], ok: false, why: "no TASKS caption" };

  // Everything before the caption is the trainer's description. Page numbers
  // and a title fragment are dropped rather than read as prose.
  const description = lines
    .slice(0, tasksAt)
    .filter((l) => !isPageNumber(l) && !isTitleLine(l) && !isCaption(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  // Walk forward collecting numbered items until the block ends. It ends at
  // the title, a caption, or a stray page number — whichever comes first.
  const tasks = [];
  let current = null;
  for (const line of lines.slice(tasksAt + 1)) {
    if (isTitleLine(line) || isCaption(line) || isPageNumber(line)) break;
    const start = line.match(TASK_START);
    if (start) {
      if (current) tasks.push(current);
      current = start[2].trim();
      continue;
    }
    // A continuation line before any "1." is page furniture, not a task.
    if (current !== null) current += ` ${line}`;
  }
  if (current) tasks.push(current);

  const cleaned = tasks.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  return {
    description,
    tasks: cleaned,
    ok: !!description || cleaned.length > 0,
    why: cleaned.length === 4 ? "" : `read ${cleaned.length} of 4 tasks`,
  };
}
