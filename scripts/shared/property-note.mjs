/**
 * Shadowdark Enhancer — the "no core Shadowdark property" note (pure).
 *
 * The Western Reaches tables print property codes the core system ships no
 * Property item for — the obsidian weapons' Obsidian, Sniper, and barding's
 * Mount. The parsers leave those off `system.properties` (there is nothing to
 * point at) and record their book labels on `draft.unmappedProps`; these two
 * helpers write them into the description so the weapon's own stat line
 * survives an import instead of asking the GM to remember it. The Lance's
 * Charge / Devastating / Mounted are handled separately by B5's managed custom
 * Property seam. LABELS ONLY — no rules text, which stays in the GM's book.
 *
 * Foundry-free on purpose, and here rather than in item-importer.mjs because
 * both the gear importer and the class-overlay importer need them: that pair
 * already depends on each other in the other direction (item-importer imports
 * class-unit-importer to tag borrowed spell lists), so the helpers living in
 * either one forces a dynamic import to dodge the cycle. Shared, they are a
 * plain static import from both, and neither path drags the other's Foundry
 * dependencies in to format a paragraph.
 *
 * Exports:
 *   withPropertyNote(description, labels) — stamp/replace the note
 *   preservedDescription(oldHtml, newHtml) — which description survives a REPLACE
 */

/**
 * The auto-note paragraph, matched so it is replaced rather than stacked on a
 * re-import and recognized as importer-generated (not GM curation) at replace
 * time. Kept in one place because every reader must agree on its shape.
 */
const PROPERTY_NOTE_RE = /<p><em>Propert(?:y|ies) with no core Shadowdark equivalent:[^<]*<\/em><\/p>/i;

/**
 * The same shape, global — used for every STRIP.
 *
 * A non-global strip removes only the first note, so a description that ever
 * came to hold two would grow a third on the next import and never converge.
 * That is reachable: `cleanImportHtml` fails closed by escaping the whole
 * description when Foundry's cleaner is unavailable, and an escaped note no
 * longer matches, so the next import stamps a second one on top of it.
 */
const PROPERTY_NOTE_ALL = new RegExp(PROPERTY_NOTE_RE.source, "gi");

/** The character references an HTML serializer produces in a text node. */
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/**
 * Decode character references, ONE level, in a single left-to-right pass.
 *
 * A pass rather than repeated replacement so `&amp;lt;` decodes to the text
 * `&lt;` and not to `<` — over-decoding would turn escaped markup back into
 * markup, which is the opposite of what the guard above it is for.
 *
 * Foundry-free by design (this module is node-tested and has no DOM), so this
 * covers what a serializer actually emits plus numeric references, and leaves
 * anything it does not recognize alone.
 */
function decodeCharacterReferences(text) {
  return String(text ?? "").replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (match, decimal, hex, named) => {
      if (named) {
        const value = NAMED_ENTITIES[named.toLowerCase()];
        return value ?? match;
      }
      const code = decimal ? Number(decimal) : Number.parseInt(hex, 16);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch { return match; }
    },
  );
}

/**
 * Two strings compared as the TEXT they represent rather than as the markup
 * that happens to encode it. Whitespace (including the non-breaking space a
 * serializer writes as `&nbsp;`) collapses, and case is ignored.
 *
 * Both sides are normalized, not just the description: the stored name is raw,
 * but a name that itself carries an escaped character must still match the
 * description that echoes it.
 */
const asComparableText = (value) => decodeCharacterReferences(value)
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase();

/**
 * The importer's OTHER generated description: the document's own name.
 *
 * `buildItemData`'s Spell path has no placeholder to fall back to — a spell
 * with no description reads badly as `<p></p>` — so it writes the name:
 * `description = draft.description || name`, wrapped as `<p>{name}</p>`. That
 * is importer output, not prose, and reading it as prose is how a paste with no
 * description column overwrote curated spell text (A8/#93).
 *
 * Recognized in both shapes the builder can emit (the wrapped paragraph and the
 * bare string), and compared as text: the description reaching this point has
 * been through `cleanImportHtml`, and Foundry's cleaner returns serialized HTML
 * in which a text `&` is `&amp;`, while the document's NAME is still raw. A
 * direct string comparison therefore misses every name containing a character
 * the serializer escapes.
 *
 * The markup guard runs BEFORE decoding and on the raw inner string, so it
 * still rejects anything that is more than one text node — an escaped `&lt;b&gt;`
 * decodes to text that simply is not the name, and stays prose. A description
 * that merely CONTAINS the name, or carries a second paragraph, is prose too.
 *
 * @param {string} html   a note-stripped description
 * @param {string} name   the document's name
 */
const isNameEcho = (html, name) => {
  const label = asComparableText(name);
  if (!label) return false;
  const body = String(html ?? "").trim();
  const inner = body.replace(/^<p>([\s\S]*)<\/p>$/i, "$1").trim();
  if (!inner || /[<>]/.test(inner)) return false;
  return asComparableText(inner) === label;
};

/**
 * Nothing but our own note, the empty placeholder, or the document's own name:
 * importer-generated.
 */
const isAutoDescription = (html, name = "") => {
  const rest = String(html ?? "").replace(PROPERTY_NOTE_ALL, "").trim();
  if (!rest || rest === "<p></p>") return true;
  return isNameEcho(rest, name);
};

/**
 * Append the "no core Shadowdark property" note to a gear description.
 *
 * Idempotent: every existing note is stripped first, so a re-import replaces
 * rather than stacks. With no labels the note is simply dropped — the same
 * answer whether or not the description also carries prose. (Keeping a stale
 * note alive is `preservedDescription`'s job, at REPLACE time, where the
 * stored document is there to be compared against.)
 *
 * @param {string} description  the description HTML the draft carries
 * @param {string[]} labels     book labels of the properties left off
 * @returns {string} description HTML to store
 */
export function withPropertyNote(description, labels = []) {
  const desc = String(description ?? "").trim();
  const names = [...new Set((labels ?? [])
    .map((l) => String(l ?? "").replace(/[<>&]/g, "").trim())
    .filter(Boolean))];
  const body = desc.replace(PROPERTY_NOTE_ALL, "").trim();
  const kept = body === "<p></p>" ? "" : body;
  if (!names.length) return kept || "<p></p>";
  const lead = names.length === 1 ? "Property" : "Properties";
  return `${kept}<p><em>${lead} with no core Shadowdark equivalent: ${names.join(", ")}.</em></p>`;
}

/**
 * Which description survives a REPLACE. The GM's own text always wins over an
 * importer default, and the property note is carried across either way, so a
 * re-import never silently drops the WR property line it wrote last time.
 *
 * The note is not prose — it is importer metadata — so a paste that lost the
 * property column is not evidence the weapon lost the property, whether the
 * incoming description is the bare placeholder or freshly typed text.
 *
 * `name` lets both sides be measured against the document they describe, so the
 * builder's `<p>{name}</p>` spell fallback counts as importer output on the way
 * in AND as nothing worth keeping on the way out. Optional and additive: with
 * no name, classification is exactly what it was before A8.
 *
 * @param {string} oldHtml  the existing document's description
 * @param {string} newHtml  the description the fresh parse produced
 * @param {{name?: string}} [opts]  the document's name, for the echo test
 * @returns {string|null} the description to store, or null to keep the incoming one
 */
export function preservedDescription(oldHtml, newHtml, { name = "" } = {}) {
  const oldDesc = String(oldHtml ?? "").trim();
  const newDesc = String(newHtml ?? "").trim();
  if (!oldDesc) return null;
  const oldNote = oldDesc.match(PROPERTY_NOTE_RE)?.[0] ?? "";
  const newNote = newDesc.match(PROPERTY_NOTE_RE)?.[0] ?? "";

  // The fresh parse carries real prose: it wins. Only the note is rescued, and
  // only when this paste didn't bring one of its own.
  if (!isAutoDescription(newDesc, name)) {
    if (newNote || !oldNote) return null;
    return `${newDesc.replace(PROPERTY_NOTE_ALL, "").trim()}${oldNote}`;
  }

  // Incoming is importer-generated. Curated text stands; a stored default has
  // nothing worth keeping.
  if (isAutoDescription(oldDesc, name)) return null;
  // No incoming note (a plain re-import): the stored description stands byte
  // for byte, stale note included.
  return newNote ? `${oldDesc.replace(PROPERTY_NOTE_ALL, "").trim()}${newNote}` : oldHtml;
}
