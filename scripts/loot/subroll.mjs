/**
 * Shadowdark Enhancer — inline sub-roll rows.
 *
 * Treasure tables in the books compress a whole family of objects into one
 * printed row:
 *
 *   "Meteorite 1d4: 1. lute, 2. viol, 3. harp, 4. flute"
 *   "Dragonscaled Altar, 1d4: 1. Memnon, 2. Ord, 3-4. Madeera"
 *
 * The row is not an item — it is a prefix plus a die that picks WHICH item.
 * Left unresolved it is flavor text nobody can hand a player, and a name
 * matcher pointed at it grabs a stray word from the option list ("White marble
 * 1d4: 1. mirror, …" → a plain 10gp Mirror). Resolving the die turns the row
 * into the concrete prize: "Meteorite harp".
 *
 * Deliberately dependency-free (no Foundry, no module imports) so it is
 * node-testable; the caller injects the dice roller.
 */

/** Options are introduced by "N." or a range "N-M." */
const OPTION_TOKEN = /(\d+)\s*(?:[-–—]\s*(\d+))?\s*\.\s*/g;
/** A dice term, optionally followed by the ":" that separates it from the list. */
const DICE_TERM = /\b(\d*d(\d+))\b\s*:?\s*/i;

/**
 * Parse an inline sub-roll row into its parts.
 *
 * @param {string} text — the raw table row
 * @returns {null|{prefix:string, dice:string, faces:number, qualifier:boolean,
 *                 options:Array<{min:number,max:number,label:string}>}}
 *   `null` when the row isn't a sub-roll. `qualifier` is true when the prefix
 *   ended with a comma, which is how the books mark the option as a property of
 *   the object ("Mithral Bottle, 1d4: 1. wine") rather than the noun itself
 *   ("Meteorite 1d4: 1. lute").
 */
export function parseInlineSubroll(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;

  const m = DICE_TERM.exec(s);
  if (!m) return null;

  const rest = s.slice(m.index + m[0].length);
  const options = [];
  const marks = [...rest.matchAll(OPTION_TOKEN)];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const start = mark.index + mark[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : rest.length;
    const label = rest.slice(start, end).replace(/[,;.\s]+$/, "").trim();
    if (!label) return null;                      // "1. , 2." — not a real list
    const min = Number(mark[1]);
    const max = mark[2] ? Number(mark[2]) : min;
    options.push({ min, max, label });
  }
  // Two options minimum, or any row merely mentioning dice ("heals 1d4 HP")
  // would parse as a sub-roll.
  if (options.length < 2) return null;

  let prefix = s.slice(0, m.index).trim();
  const qualifier = prefix.endsWith(",");
  if (qualifier) prefix = prefix.slice(0, -1).trim();

  return { prefix, dice: m[1].toLowerCase(), faces: Number(m[2]), qualifier, options };
}

/**
 * The object named by a parsed sub-roll at `rolled`.
 * A roll landing in a gap (printed tables do skip numbers) takes the nearest
 * option rather than yielding nothing.
 */
export function subrollName(parsed, rolled) {
  if (!parsed?.options?.length) return "";
  const n = Number(rolled);
  const hit = parsed.options.find(o => n >= o.min && n <= o.max)
    ?? parsed.options.reduce((best, o) =>
      Math.abs(o.min - n) < Math.abs(best.min - n) ? o : best);

  if (!parsed.prefix) return hit.label;
  return parsed.qualifier ? `${parsed.prefix} (${hit.label})` : `${parsed.prefix} ${hit.label}`;
}

/**
 * Resolve a row to the object it names, or null when it isn't a sub-roll.
 *
 * @param {string} text
 * @param {(dice:string) => Promise<number>|number} rollDice — injected so this
 *   module stays Foundry-free; callers pass a `Roll` evaluator.
 */
export async function resolveInlineSubroll(text, rollDice) {
  const parsed = parseInlineSubroll(text);
  if (!parsed) return null;
  const rolled = await rollDice(parsed.dice);
  return subrollName(parsed, rolled);
}
