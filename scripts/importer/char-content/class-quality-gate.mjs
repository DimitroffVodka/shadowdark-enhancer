/**
 * Shared class-import quality gate.
 *
 * ONE place computes the blocking issues and ONE dialog confirms an override,
 * used by every UI adapter (the dedicated Class Importer app AND the generic
 * Importer Hub) so a class can never commit its blockers silently and the
 * dialog markup is not duplicated.
 *
 * It pairs with the fail-closed `allowInvalid` contract on
 * createClassUnit / mergeClassSupplement (class-unit-importer.mjs): the
 * low-level persistence refuses BLOCKER-grade issues and returns a
 * `{ blocked: true, issues }` sentinel unless the caller passes
 * `allowInvalid: true`. A UI adapter only passes that after the user picks
 * "Create anyway" here — so a DIRECT caller that forgets to gate fails closed
 * (nothing is written) instead of silently persisting a broken class.
 *
 * These helpers are intentionally pure (no Foundry imports at module load) so
 * they are node-testable; only confirmClassGate() touches the Foundry dialog
 * API, and only when there is actually something to confirm.
 */

/** Strip a leading "BLOCKER:" tag for display. */
const stripBlocker = (w) => String(w ?? "").replace(/^BLOCKER:\s*/i, "").trim();

/**
 * BLOCKER-grade issues (display strings) inside a warnings array. Pure.
 * @param {string[]} [warnings]
 * @returns {string[]}
 */
export function classGateBlockers(warnings = []) {
  return (warnings ?? [])
    .map(String)
    .filter((w) => /^BLOCKER:/i.test(w))
    .map(stripBlocker);
}

/**
 * BLOCKER-grade issues for a stage-2 SUPPLEMENT merge onto a class whose
 * spellcasting.class is `spellcastingClass`. Pure.
 *
 * The primary blocker: a SPELLS KNOWN grid merged onto a class flagged
 * "__not_spellcaster__" — the body import lost its Spellcasting feature (WR
 * prints it after the talents box), so writing the grid would strand it on a
 * non-caster with no enabler talent and no level-up spell choices.
 *
 * @param {string} spellcastingClass  cls.system.spellcasting.class
 * @param {object} sup                { spellsKnown?, warnings?, … }
 * @param {string} [className]        for the message (defaults to "This class")
 * @returns {string[]}
 */
export function supplementGateBlockers(spellcastingClass, sup, className = "This class") {
  const issues = classGateBlockers(sup?.warnings);
  const hasGrid = (sup?.spellsKnown?.length ?? 0) > 0;
  const nonCaster = String(spellcastingClass ?? "") === "__not_spellcaster__";
  if (hasGrid && nonCaster && !issues.some((w) => /not a spellcaster|SPELLS KNOWN/i.test(w))) {
    issues.push(
      `"${className}" is marked NOT a spellcaster, but this paste carries a SPELLS KNOWN grid — ` +
      `the body import probably lost its Spellcasting feature (it can print after the talents box). ` +
      `Re-import the class body, or set the casting ability and enabler talent by hand.`
    );
  }
  return issues;
}

/**
 * Human-readable issues that should gate a CLASS BODY commit (create flow).
 * Pure — the superset the dedicated Class Importer surfaces before create.
 * @param {object} o
 * @param {string[]} [o.warnings]       parsed/report warnings
 * @param {boolean}  [o.hasTalentTable] a talent table is present (this stage or already attached)
 * @param {boolean}  [o.isSupplement]   the draft is a stage-2 supplement (a missing table is expected)
 * @param {string[]} [o.titleWarnings]  per-band title-split warnings
 * @returns {string[]}
 */
export function classGateIssues({ warnings = [], hasTalentTable = false, isSupplement = false, titleWarnings = [] } = {}) {
  const issues = [];
  if (!hasTalentTable && !isSupplement)
    issues.push("No talent table — the class will be created without its level-up rolls.");
  for (const w of classGateBlockers(warnings)) issues.push(w);
  for (const w of (titleWarnings ?? [])) issues.push(String(w));
  return issues;
}

/**
 * Shared "create anyway?" confirmation. Returns true to commit despite the
 * issues, false to cancel. Returns true immediately when there is nothing to
 * confirm, so callers can gate unconditionally:
 *
 *     if (!(await confirmClassGate(name, issues))) return;   // cancelled
 *     await createClassUnit(parsed, { allowInvalid: issues.length > 0 });
 *
 * @param {string} name
 * @param {string[]} issues
 * @returns {Promise<boolean>}
 */
export async function confirmClassGate(name, issues) {
  if (!issues?.length) return true;
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Class quality check" },
    position: { width: 460 },
    content:
      `<p><strong>${esc(name || "This class")}</strong> has unresolved issues:</p>` +
      `<ul>${issues.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` +
      `<p>Create it anyway, or cancel and fix the flagged parts first?</p>`,
    buttons: [
      { action: "cancel", label: "Cancel and fix", icon: "fa-solid fa-xmark", default: true },
      { action: "create-anyway", label: "Create anyway", icon: "fa-solid fa-triangle-exclamation" },
    ],
    rejectClose: false,
  });
  return choice === "create-anyway";
}
