/**
 * Shadowdark Enhancer — the contextual check/request/roll enricher (A5, #56/#61).
 *
 * ONE owner for three things that were about to be re-decided per consumer:
 * the markup each context emits, which context an expression is in, and what
 * counts as already enriched. #56 wants an Arctic Sea row's "DC 15 DEX or 2d4
 * damage" to become a clickable check; #61 wants the same prose in a monster's
 * stat block to become a GM-side REQUEST instead. Same characters, different
 * button — so the syntax cannot be inferred from the text, and this module
 * refuses to try. The caller states the context and gets exactly one answer:
 *
 *   | context       | expression   | emitted                  |
 *   |---------------|--------------|--------------------------|
 *   | `table`       | `DC 15 DEX`  | `[[check 15 dex]]`       |
 *   | `environment` | `DC 15 DEX`  | `[[check 15 dex]]`       |
 *   | `monster`     | `DC 15 DEX`  | `[[request 15 dex]]`     |
 *   | any           | `2d4`        | `[[/r 2d4]]`             |
 *
 * `table` and `environment` share a command TODAY and are still separate names:
 * the callers are different tickets (E1 rows, E3 terrain prose) and collapsing
 * them would make a later divergence a caller-side edit rather than a one-line
 * change here. An unknown or missing context THROWS rather than defaulting,
 * because the failure this ticket exists to prevent is one syntax silently
 * serving every context.
 *
 * The emitted forms are dictated by the system's own enricher
 * (`systems/shadowdark/src/enrichers.mjs`), whose pattern is
 * `\[\[(check|request)\s(\d+)\s(\w{3})\]\]` — exactly one space between tokens
 * and a THREE-letter ability key. So "DC 15 Dexterity" must be emitted as
 * `dex`, and any spacing variation is dead markup that renders as literal text.
 *
 * THE INVARIANT, and the reason this is a mask rather than a chain of
 * `String.replace` calls: **enrichment is a fixed point.** Everything already
 * enriched — `[[…]]` inline macros, `@UUID[…]{…}` links, HTML tags — is masked
 * off before any rule runs, so a second pass over enriched output returns the
 * SAME BYTES, and no rule can rewrite the inside of another rule's markup. The
 * mask also makes the rules mutually exclusive: a span one rule claims is
 * unavailable to the next, so `DC 15 DEX` and `2d4` can never contest the same
 * characters. Ordering is therefore a policy statement (checks are the more
 * specific reading and win), not an accident of replacement order.
 *
 * Conservative on purpose: only a FULLY determined expression converts. A bare
 * "DC 15" with no ability, or "DC 15 damage" whose next word is not one, is
 * left as prose — this module never deletes or reorders text, it only wraps a
 * span it can name, so a row's readable text survives verbatim around the
 * markup. Every rule requires at least one character; a rule that could match
 * empty would spin the collector's `exec` loop forever.
 *
 * Foundry-free and pure. `enrichDice` is the dice half on its own, exported so
 * the monster linker's `convertDice` can delegate here instead of keeping a
 * second, subtly weaker copy of the same syntax.
 */

/**
 * The approved command per enrichment context. This map IS the contract A5
 * owns; consumers name a context, never a command.
 */
export const ENRICH_CONTEXTS = Object.freeze({
  table: "check",
  environment: "check",
  monster: "request",
});

/** Book spellings → the three-letter key the system's enricher requires. */
const ABILITY_KEYS = Object.freeze({
  str: "str", strength: "str",
  dex: "dex", dexterity: "dex",
  con: "con", constitution: "con",
  int: "int", intelligence: "int",
  wis: "wis", wisdom: "wis",
  cha: "cha", charisma: "cha",
});

/**
 * Spans that are already markup. Masking these — not a negative lookbehind — is
 * what makes enrichment a fixed point: `[[…]]` covers every inline macro this
 * module or a GM may have written (`[[/r …]]`, `[[check …]]`, `[[request …]]`),
 * `@UUID[…]{…}` keeps a monster link's LABEL from being rewritten, and the tag
 * pattern keeps attribute values in HTML rows out of reach.
 */
const PROTECTED_PATTERNS = [
  /@UUID\[[^\]]*\]\{[^}]*\}/g,
  /\[\[[^\]]*\]\]/g,
  /<\/?[a-zA-Z][^>]*>/g,
];

/** "DC 15 DEX", "DC 15 Dexterity" — a check target with a named ability. */
const DC_RE = /\bDC\s*(\d+)\s+([A-Za-z]+)\b/gi;

/** A bare dice token with an optional multiplier: "2d4", "1d4*10". */
const DICE_RE = /\b\d+d\d+(?:[*x]\d+)?\b/gi;

/**
 * An inline roll whose `]]` is missing. The mask only covers CLOSED markup, so
 * this preserves the older `convertDice` guard for malformed input: "[[/r 2d4"
 * stays as it is rather than growing a second `[[/r`.
 */
const OPEN_ROLL = /\[\[\/r\s$/i;

/** Mark every character that already belongs to markup. */
function protectedSpans(src) {
  const taken = new Array(src.length).fill(false);
  for (const re of PROTECTED_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      for (let i = m.index; i < m.index + m[0].length; i++) taken[i] = true;
    }
  }
  return taken;
}

/**
 * Collect the non-overlapping edits `re` proposes over the unclaimed parts of
 * `src`. `build` returns the replacement, or null to decline the match and
 * leave those characters available to a later rule.
 */
function collectEdits(src, taken, re, build, out) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    const end = start + m[0].length;
    let clash = false;
    for (let i = start; i < end; i++) if (taken[i]) { clash = true; break; }
    if (clash) continue;
    const text = build(m, start);
    if (text == null) continue;
    for (let i = start; i < end; i++) taken[i] = true;
    out.push({ start, end, text });
  }
}

/**
 * The single pass. `command` is "check"/"request", or null for dice only.
 */
function enrich(text, command) {
  const src = String(text ?? "");
  if (!src) return src;
  const taken = protectedSpans(src);
  const edits = [];
  if (command) {
    collectEdits(src, taken, DC_RE, (m) => {
      const stat = ABILITY_KEYS[m[2].toLowerCase()];
      // Not an ability ("DC 15 damage") — leave the prose alone.
      return stat ? `[[${command} ${Number(m[1])} ${stat}]]` : null;
    }, edits);
  }
  collectEdits(src, taken, DICE_RE, (m, start) => (
    OPEN_ROLL.test(src.slice(Math.max(0, start - 5), start)) ? null : `[[/r ${m[0]}]]`
  ), edits);
  if (!edits.length) return src;
  edits.sort((a, b) => b.start - a.start); // apply right-to-left
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * Enrich one piece of text for a stated context: check targets become the
 * context's approved `[[check …]]`/`[[request …]]` markup and bare dice become
 * inline rolls. Idempotent — enriching enriched output returns the same bytes.
 *
 * @param {string} text
 * @param {object} options
 * @param {"table"|"environment"|"monster"} options.context  REQUIRED; never inferred.
 * @returns {string}
 * @throws {TypeError} on a missing or unknown context.
 */
export function enrichContextualText(text, { context } = {}) {
  const command = Object.prototype.hasOwnProperty.call(ENRICH_CONTEXTS, context)
    ? ENRICH_CONTEXTS[context]
    : null;
  if (!command) {
    throw new TypeError(
      `enrichContextualText: unknown context ${JSON.stringify(context)}; expected one of ${Object.keys(ENRICH_CONTEXTS).join(", ")}`
    );
  }
  return enrich(text, command);
}

/**
 * The dice half alone: wrap bare dice tokens ("2d20") in an inline roll. Leaves
 * already-wrapped rolls, lone die sizes ("d6" with no count), and every other
 * protected span untouched. Context-free, because a dice expression reads the
 * same in every context.
 *
 * @param {string} text
 * @returns {string}
 */
export function enrichDice(text) {
  return enrich(text, null);
}
