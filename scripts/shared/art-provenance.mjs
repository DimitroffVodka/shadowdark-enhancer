/**
 * Shadowdark Enhancer — explicit art provenance for imported Items (pure).
 *
 * The importer used to guess whether an image was worth keeping from the SHAPE
 * of the path it was about to write: `img.startsWith("icons/") ||
 * img.includes("default")`. That reads the wrong document (the incoming
 * payload, not the stored one) and it is wrong on this module's own art — a
 * bundled Shikashi default is `modules/shadowdark-enhancer/assets/icons/…`,
 * which passes neither test, so a re-import of a dagger silently overwrote the
 * GM's hand-picked art. A curated `icons/...` pick has the opposite problem: it
 * is indistinguishable from a default, so nothing could ever upgrade it.
 *
 * Provenance replaces the guess with a WITNESS. Every image this module writes
 * is stamped with the state it was written in AND the exact path written:
 *
 *   flags["shadowdark-enhancer"].art = { state, img }
 *
 * On the next import the stored `img` is compared against the witness. Equal
 * means nobody has touched it since we wrote it, so the recorded state stands.
 * Different means a human changed it, whatever the path looks like — that is
 * GM-custom art and it survives.
 *
 * Four states, three of them upgradeable:
 *
 * | State      | Meaning                                    | Upgradeable |
 * |------------|--------------------------------------------|-------------|
 * | `default`  | the module's automatic pick (type default,  | yes         |
 * |            | `pickTreasureIcon`, `pickShikashiSpellIcon`)|             |
 * | `imported` | the image the source draft carried, as      | yes         |
 * |            | imported and untouched since               |             |
 * | `curated`  | a deliberate module icon pick (A4)          | yes         |
 * | `custom`   | the GM changed it by hand                   | NO          |
 *
 * LEGACY (unmarked) documents predate the stamp and cannot be asked. They are
 * classified deterministically and conservatively: an image byte-identical to
 * what this module's default picker would produce for that document TODAY is
 * `default`; a blank image is `default`; anything else is `custom`. An
 * untouched imported image on a legacy document is therefore treated as custom
 * and preserved — the safe direction, since nothing distinguishes it from a GM
 * edit after the fact. The first re-import stamps the verdict, so the
 * classification is decided once and never drifts.
 *
 * GENERATED-ARTIFACT BOUNDARY. Generated artifacts inside the managed Items
 * pack are authoritative and replace-always, art included (see A7/D6). They sit
 * OUTSIDE the preservation policy above, and the boundary is drawn
 * structurally — managed pack membership plus an explicit generated flag —
 * never from a path shape or a name. A3 only consumes this boundary;
 * stamping `generated` is the generating pipeline's job.
 *
 * Foundry-free and node-testable: every export takes plain documents/objects.
 *
 * Exports:
 *   ART_STATES / UPGRADEABLE_ART_STATES
 *   artProvenance(state, img)          — build the flag value
 *   readArtProvenance(document)        — the stored witness, or null
 *   classifyArt(document, opts)        — which state a stored document is in
 *   isArtUpgradeable(document, opts)   — may this module replace the image?
 *   decideImportArt(opts)              — the whole replace-time art decision
 *   isGeneratedArtifact(document)      — the flag half of the boundary
 *   isGeneratedManagedItem(doc, pack)  — the full structural boundary
 *   MANAGED_ITEMS_PACK
 */
import { MODULE_ID } from "./module-id.mjs";

/** The four image states an imported Item's art can be in. */
export const ART_STATES = Object.freeze({
  DEFAULT:  "default",
  IMPORTED: "imported",
  CURATED:  "curated",
  CUSTOM:   "custom",
});

/**
 * The states this module may overwrite. `custom` is the whole point of the
 * mechanism and is deliberately absent.
 */
export const UPGRADEABLE_ART_STATES = Object.freeze([
  ART_STATES.DEFAULT,
  ART_STATES.IMPORTED,
  ART_STATES.CURATED,
]);

const KNOWN_STATES = new Set(Object.values(ART_STATES));

/**
 * The managed world Items pack. Named here rather than derived because the
 * generated-artifact boundary is structural: it must not move when a pack is
 * relabelled. The name is one of the five persisted pack names that cannot
 * change without a migration.
 */
export const MANAGED_ITEMS_PACK = "world.shadowdark-enhancer--items";

/**
 * Compare image paths the way Foundry stores them. Only whitespace and a
 * leading `./` are normalized — case and encoding are left alone, because two
 * paths that differ there ARE two different files on a case-sensitive server.
 * @param {unknown} img
 * @returns {string} "" when there is no image
 */
export function normalizeArtPath(img) {
  const s = String(img ?? "").trim();
  return s.startsWith("./") ? s.slice(2) : s;
}

/**
 * Build the flag value to stamp alongside an image this module is writing.
 * The path is recorded with the state so the next import can tell whether the
 * image is still the one we wrote.
 * @param {string} state  one of ART_STATES
 * @param {string} img    the path being written
 * @returns {{state: string, img: string}}
 */
export function artProvenance(state, img) {
  const s = String(state ?? "");
  return {
    state: KNOWN_STATES.has(s) ? s : ART_STATES.DEFAULT,
    img: normalizeArtPath(img),
  };
}

/**
 * The provenance witness stored on a document, if it has one. Accepts a live
 * document or a plain creation payload.
 * @param {object} document
 * @returns {{state: string, img: string}|null}
 */
export function readArtProvenance(document) {
  const raw = document?.flags?.[MODULE_ID]?.art;
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.state !== "string") return null;
  return { state: raw.state, img: normalizeArtPath(raw.img) };
}

/**
 * Which art state a stored document is in.
 *
 * Marked documents answer from their witness: the recorded state stands only
 * while the stored image still matches the path we recorded. Any divergence —
 * including a state string this version does not recognize — is `custom`,
 * because an image we cannot account for is one we must not overwrite.
 *
 * Unmarked (legacy) documents are classified against `moduleDefaultImg`, the
 * image this module's default picker produces for that document today. Equal
 * or blank is `default`; anything else is `custom`. Deterministic, total, and
 * conservative in the direction that cannot destroy art.
 *
 * @param {object} document
 * @param {{moduleDefaultImg?: string}} [opts]
 * @returns {string} one of ART_STATES
 */
export function classifyArt(document, { moduleDefaultImg = "" } = {}) {
  const img = normalizeArtPath(document?.img);
  if (!img) return ART_STATES.DEFAULT;   // no art to protect

  const stamp = readArtProvenance(document);
  if (stamp) {
    if (stamp.img !== img) return ART_STATES.CUSTOM;          // changed since we wrote it
    return KNOWN_STATES.has(stamp.state) ? stamp.state : ART_STATES.CUSTOM;
  }

  // Legacy, unmarked.
  return img === normalizeArtPath(moduleDefaultImg) ? ART_STATES.DEFAULT : ART_STATES.CUSTOM;
}

/**
 * May this module replace the document's image?
 * @param {object} document
 * @param {{moduleDefaultImg?: string}} [opts]
 * @returns {boolean}
 */
export function isArtUpgradeable(document, opts) {
  return UPGRADEABLE_ART_STATES.includes(classifyArt(document, opts));
}

/**
 * The flag half of the generated-artifact boundary: a document this module
 * generated rather than imported. Recognizes the shared
 * `flags[MODULE_ID].generated` marker and the Monster Spell library's existing
 * per-feature marker.
 * @param {object} document
 * @returns {boolean}
 */
export function isGeneratedArtifact(document) {
  const flags = document?.flags?.[MODULE_ID];
  return flags?.generated === true || flags?.monsterSpell?.generated === true;
}

/**
 * The full structural boundary: a generated artifact living in the managed
 * Items pack. Only documents on this side of the line are replace-always;
 * everything else obeys the provenance policy above.
 * @param {object} document
 * @param {string} packCollection  the pack's `collection` id
 * @returns {boolean}
 */
export function isGeneratedManagedItem(document, packCollection) {
  return isGeneratedArtifact(document)
    && String(packCollection ?? "") === MANAGED_ITEMS_PACK;
}

/**
 * The whole replace-time art decision, in one call.
 *
 * Returns the image to store and the provenance to stamp beside it. The
 * `preserved` flag says whether the GM's art won; `reason` names the branch so
 * callers and tests can assert on the transition rather than infer it.
 *
 * @param {object}  opts
 * @param {string}  opts.incomingImg        the image the fresh import would write
 * @param {string}  [opts.incomingState]    the state that image is in (default `default`)
 * @param {object}  [opts.existing]         the stored document being replaced
 * @param {string}  [opts.moduleDefaultImg] this module's default pick for that document
 * @param {boolean} [opts.generatedArtifact] true inside the generated boundary
 * @returns {{img: string, provenance: {state: string, img: string}, preserved: boolean, reason: string}}
 */
export function decideImportArt({
  incomingImg,
  incomingState = ART_STATES.DEFAULT,
  existing = null,
  moduleDefaultImg = "",
  generatedArtifact = false,
} = {}) {
  const incoming = artProvenance(incomingState, incomingImg);
  const take = (reason) => ({ img: incoming.img, provenance: incoming, preserved: false, reason });

  // Generated artifacts in the managed Items pack are authoritative — their
  // owning pipeline replaces them wholesale, art included.
  if (generatedArtifact) return take("generated-artifact");

  const existingImg = normalizeArtPath(existing?.img);
  if (!existingImg) return take("no-existing-art");

  const state = classifyArt(existing, { moduleDefaultImg });
  if (state === ART_STATES.CUSTOM) {
    return {
      img: existingImg,
      provenance: artProvenance(ART_STATES.CUSTOM, existingImg),
      preserved: true,
      reason: "gm-custom",
    };
  }
  return take(`upgrade-${state}`);
}
