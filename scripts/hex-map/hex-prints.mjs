/**
 * Shadowdark Enhancer — what is known about each book's hex map, pure (no book content).
 *
 * The import wizard sets up a hex map without asking, so for each print it needs the few facts a GM would
 * otherwise type into the confirm window: which book's key locations pin onto it and where that book's crawls are
 * filed, and the number printed on its first hex. Each is a number or a name, never a pixel or a line of text.
 *
 *   keySrc    the source key whose key locations (importKeyLocations) belong on this map
 *   folder    the folder name (sourceFolderName) its crawl entries are filed under
 *   firstNum  the printed number of the top-left hex, when it is not 0000. The Gloaming, The Djurum and the Isles
 *             of Andrik are 0001 (columns count from 0, rows from 1); on all 62 keyed hexes of those three books
 *             each number lands on the hex the map outlines (docs/wiki/Hex-Maps.md, Numbering the map to match).
 *   byHand    why the wizard cannot do this map alone: "black" (filled with black, so the grid finder cannot read it:
 *             the corners are set by hand) or "halves" (two files that have to be stitched, which is not built).
 *             The Done page offers the interactive Hex map from image for these.
 *
 * The Western Reaches A0 is not here for its numbers: its lattice is known (a0-print.mjs) and it needs no firstNum.
 */

export const HEX_PRINTS = Object.freeze({
  "hex-wr":  { keySrc: "GMWR", folder: "Western Reaches" },
  "hex-cs1": { keySrc: "CS1", folder: "CS1", firstNum: "0001" },
  "hex-cs2": { keySrc: "CS2", folder: "CS2", firstNum: "0001" },
  "hex-cs3": { keySrc: "CS3", folder: "CS3", firstNum: "0001" },
  "hex-cs4": { keySrc: "CS4", folder: "CS4", byHand: "halves" },
  "hex-cs5": { keySrc: "CS5", folder: "CS5", byHand: "black" },
});

/** The facts for a hex map id, or null for a map this module knows nothing about. */
export const hexPrint = (id) => HEX_PRINTS[String(id).split(":")[0]] ?? null;
