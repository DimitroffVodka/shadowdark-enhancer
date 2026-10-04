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
import { t as tr } from "../importer-hub-shared.mjs";

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
export function supplementGateBlockers(spellcastingClass, sup, className = tr("SDE.importer.charContent.gate.thisClass")) {
  const issues = classGateBlockers(sup?.warnings);
  const hasGrid = (sup?.spellsKnown?.length ?? 0) > 0;
  const nonCaster = String(spellcastingClass ?? "") === "__not_spellcaster__";
  if (hasGrid && nonCaster && !issues.some((w) => /not a spellcaster|SPELLS KNOWN/i.test(w))) {
    issues.push(tr("SDE.importer.charContent.gate.notCaster", { name: className }));
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
    issues.push(tr("SDE.importer.charContent.gate.noTalentTable"));
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
    classes: ["sde-ui", "sde-dialog"],
    window: { title: "SDE.importer.charContent.gate.title" },
    position: { width: 460 },
    content:
      `<p>${tr("SDE.importer.charContent.gate.lead", { name: esc(name || tr("SDE.importer.charContent.gate.thisClass")) })}</p>` +
      `<ul>${issues.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` +
      `<p>${tr("SDE.importer.charContent.gate.question")}</p>`,
    buttons: [
      { action: "cancel", label: "SDE.importer.charContent.gate.cancelFix", icon: "fa-solid fa-xmark", default: true },
      { action: "create-anyway", label: "SDE.importer.charContent.gate.createAnyway", icon: "fa-solid fa-triangle-exclamation" },
    ],
    rejectClose: false,
  });
  return choice === "create-anyway";
}
