/**
 * Shadowdark Enhancer — Compound generator roll behaviour.
 *
 * A "compound generator" is a single RollTable whose columns are each rolled
 * once and concatenated in order (a mad-libs / sentence generator, e.g. a
 * PRAYER GENERATOR). The column data lives self-contained in
 * `flags.shadowdark-enhancer.compound = { separator, columns: [{ label, formula,
 * rows:[{min,max,text}] }] }` — no sub-tables (see table-importer.mjs).
 *
 * `installCompoundRollTable()` wraps `RollTable.prototype.draw` so ANY roll of a
 * compound table — the Foundry sidebar sheet's Roll button, a hover roll, or our
 * own hub button (which just calls `table.draw()`) — draws every column and posts
 * one combined chat card. Non-compound tables fall straight through to core.
 */
import { MODULE_ID } from "../module-id.mjs";

/** Install the draw() wrap once. Idempotent — safe to call from init. */
export function installCompoundRollTable() {
  const proto = RollTable.prototype;
  if (proto._sdeCompoundInstalled) return;
  const origDraw = proto.draw;
  proto.draw = async function (options = {}) {
    const compound = this.getFlag(MODULE_ID, "compound");
    if (compound?.columns?.length) return sdeCompoundDraw(this, compound, options);
    return origDraw.call(this, options);
  };
  proto._sdeCompoundInstalled = true;
}

/** True when a document carries compound-generator data. */
export function isCompoundTable(table) {
  return !!table?.getFlag?.(MODULE_ID, "compound")?.columns?.length;
}

/** Highest face referenced by a column's rows (fallback die size). */
function maxFace(rows) {
  return (rows ?? []).reduce((m, r) => Math.max(m, Number(r.max) || 0), 0);
}

/**
 * Roll every column of a compound table and (unless suppressed) post one chat
 * card. Returns a `{ roll, results, sde }` shape loosely mirroring core draw()
 * so callers that only read the posted card keep working.
 */
export async function sdeCompoundDraw(table, compound, options = {}) {
  const sep = typeof compound.separator === "string" ? compound.separator : " ";
  const detail = [];
  for (const col of compound.columns) {
    const formula = (col.formula ?? "").trim() || `1d${Math.max(1, maxFace(col.rows))}`;
    let face = 1;
    try {
      face = (await new Roll(formula).evaluate()).total;
    } catch (err) {
      console.warn(`${MODULE_ID} | compound column "${col.label}" bad formula "${formula}":`, err);
    }
    const row = (col.rows ?? []).find(r => face >= r.min && face <= r.max);
    detail.push({ label: col.label ?? "", face, text: (row?.text ?? "").trim() });
  }
  const combined = detail.map(d => d.text).filter(Boolean).join(sep);

  let message = null;
  if (options.displayChat !== false) {
    message = await postCompoundCard(table, combined, detail, options);
  }
  return { roll: null, results: [], sde: { compound: true, combined, detail, message } };
}

/** Post the combined-result chat card with a per-column breakdown. */
async function postCompoundCard(table, combined, detail, options = {}) {
  const rows = detail.map(d => `
    <div class="sde-cg-part">
      <span class="sde-cg-die" data-tooltip="${foundry.utils.escapeHTML(d.label)}">${d.face}</span>
      <span class="sde-cg-label">${foundry.utils.escapeHTML(d.label)}</span>
      <span class="sde-cg-text">${foundry.utils.escapeHTML(d.text) || "—"}</span>
    </div>`).join("");

  const content = `
    <div class="sde-compound-card">
      <header class="sde-cg-head"><i class="fas fa-dice-d6"></i> ${foundry.utils.escapeHTML(table.name)}</header>
      <div class="sde-cg-combined">${foundry.utils.escapeHTML(combined) || "<em>(empty)</em>"}</div>
      <details class="sde-cg-detail"><summary>Breakdown</summary>${rows}</details>
    </div>`;

  const data = {
    speaker: ChatMessage.getSpeaker(),
    content,
    flags: { [MODULE_ID]: { compoundResult: { tableUuid: table.uuid, combined, detail } } },
  };
  if (options.rollMode) ChatMessage.applyRollMode(data, options.rollMode);
  return ChatMessage.create(data);
}

export const CompoundTable = { install: installCompoundRollTable, isCompoundTable, draw: sdeCompoundDraw };
