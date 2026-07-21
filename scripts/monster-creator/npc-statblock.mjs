/**
 * Shadowdark Enhancer — NPC stat-block notes builder (pure, node-testable).
 *
 * The Shadowdark NPC sheet's "Description" tab renders the actor's `system.notes`
 * HTML. The system's own bestiary bakes a FULL formatted stat block there:
 *
 *   <p><i>flavor</i></p>
 *   <p><strong>AC</strong> 18 ( … ), <strong>HP</strong> 76, <strong>ATK</strong> …,
 *      <strong>MV</strong> …, <strong>S</strong> +5, … <strong>AL</strong> L, <strong>LV</strong> 16</p>
 *   <p><strong>Feature</strong>. text</p> …
 *
 * `buildNpcNotes(draft)` reproduces that format from a Monster-Creator draft, so
 * imported / created NPCs read like the base system. Built from the (editable)
 * draft FIELDS, so it always reflects the actor's actual data. Pure — no Foundry,
 * no DOM.
 */

const MOVE_DISPLAY = {
  close: "close", near: "near", far: "far",
  doubleNear: "double near", tripleNear: "triple near",
  none: "none", special: "special",
};

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const sign = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "+0";
  return v >= 0 ? `+${v}` : `${v}`;
};

/** Reconstruct the packed MV text ("double near (fly)") from move key + note. */
export function buildMvText(draft) {
  const base = MOVE_DISPLAY[draft?.move] ?? draft?.move ?? "near";
  const note = String(draft?.moveNote ?? "").trim();
  return note ? `${base} (${note})` : base;
}

/** Reconstruct the packed ATK text ("3 rend +9 (2d10) and 1 spell +4") from actions + spellcasting. */
export function buildAtkText(draft) {
  const clauses = [];
  for (const a of (draft?.actions ?? [])) {
    const num = Number(a?.num ?? 1);
    if (a?.type === "NPC Special Attack") {
      clauses.push(`${num} ${String(a?.name ?? "").toLowerCase()}`.trim());
      continue;
    }
    const ranges = Array.isArray(a?.ranges) ? a.ranges.filter(Boolean) : [];
    const rangeStr = (ranges.length && !(ranges.length === 1 && ranges[0] === "close"))
      ? ` (${ranges.join("/")})` : "";
    let dmg = "";
    if (a?.damage && a?.description) dmg = ` (${a.damage} + ${a.description})`;
    else if (a?.damage) dmg = ` (${a.damage})`;
    else if (a?.description) dmg = ` (${a.description})`;
    // Stat line uses lowercase attack names ("1 dagger"); the item itself is Title Case.
    clauses.push(`${num} ${String(a?.name ?? "attack").toLowerCase()}${rangeStr} ${sign(a?.bonus)}${dmg}`.replace(/\s+/g, " ").trim());
  }
  const sc = draft?.spellcasting;
  if (sc && Number(sc.attacks) > 0) {
    const n = Number(sc.attacks);
    clauses.push(`${n} spell${n === 1 ? "" : "s"}${sc.bonus ? ` ${sign(sc.bonus)}` : ""}`);
  }
  return clauses.join(" and ");
}

/**
 * Build the full stat-block HTML for `system.notes`, matching the system format.
 * @param {object} draft — Monster Creator draft (see _defaultDraft)
 * @returns {string} HTML
 */
export function buildNpcNotes(draft) {
  if (!draft) return "";
  const parts = [];

  const flavor = String(draft.description ?? "").trim();
  if (flavor) parts.push(`<p><i>${esc(flavor)}</i></p>`);

  const ab = draft.abilities ?? {};
  const acNote = String(draft.acNote ?? "").trim();
  const hp = draft.hp?.value ?? draft.hp?.max ?? "";
  const bits = [
    `<strong>AC</strong> ${esc(draft.ac ?? "")}${acNote ? ` (${esc(acNote)})` : ""}`,
    `<strong>HP</strong> ${esc(hp)}`,
  ];
  const atk = buildAtkText(draft);
  if (atk) bits.push(`<strong>ATK</strong> ${esc(atk)}`);
  bits.push(`<strong>MV</strong> ${esc(buildMvText(draft))}`);
  bits.push(`<strong>S</strong> ${sign(ab.str)}`);
  bits.push(`<strong>D</strong> ${sign(ab.dex)}`);
  bits.push(`<strong>C</strong> ${sign(ab.con)}`);
  bits.push(`<strong>I</strong> ${sign(ab.int)}`);
  bits.push(`<strong>W</strong> ${sign(ab.wis)}`);
  bits.push(`<strong>Ch</strong> ${sign(ab.cha)}`);
  bits.push(`<strong>AL</strong> ${esc(draft.alignment ?? "N")}`);
  bits.push(`<strong>LV</strong> ${esc(draft.level ?? "")}`);
  parts.push(`<p>${bits.join(", ")}</p>`);

  for (const f of (draft.features ?? [])) {
    const name = String(f?.name ?? "").trim();
    const text = String(f?.description ?? "").trim();
    if (!name && !text) continue;
    parts.push(`<p>${name ? `<strong>${esc(name)}</strong>. ` : ""}${esc(text)}</p>`);
  }

  return parts.join("\n");
}

/**
 * Pull just the italic flavor line back out of a stat-block notes blob (for the
 * editable draft, whose `description` is the flavor only). Matches both our
 * output and the system's `<i>…</i>` flavor; falls back to a full tag-strip for
 * legacy flavor-only notes. Pure (regex, no DOM).
 */
export function extractFlavor(notes) {
  const s = String(notes ?? "");
  if (!s) return "";
  const m = /<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(s);
  const pick = m ? m[2] : s;
  return pick
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}
