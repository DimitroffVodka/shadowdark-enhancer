/**
 * Shadowdark Enhancer — Shikashi icon matcher.
 *
 * Maps item names to the bundled Shikashi's Fantasy Icons Pack v2 set
 * (assets/icons/shikashi/, 284 icons sliced from the pack spritesheet;
 * see CREDITS.md). Pure and node-testable. First matching rule wins, so
 * specific patterns must stay above generic ones (e.g. "spell scroll"
 * before "scroll", "leather armor" before "armor").
 */

const BASE = "modules/shadowdark-enhancer/assets/icons/shikashi/";

/** Full img path for a Shikashi icon slug. */
export function shikashiIcon(slug) {
  return `${BASE}${slug}.webp`;
}

// Ordered [pattern, slug] rules, matched against the lowercased item name.
const RULES = [
  // -- documents & magic writings --------------------------------------
  [/spell\s*scroll|magic\s*scroll/, "magic-scroll-1"],
  [/\bscroll\b/, "tied-scroll"],
  [/\bmap\b/, "old-map"],
  [/spellbook|spell\s*book/, "spellbook"],
  [/journal|ledger|diary/, "open-book"],
  [/\bletter\b|missive|\bnote\b/, "letter"],
  [/\bbook\b|tome|grimoire|bestiary|manual|codex/, "book-1"],
  // -- consumables ------------------------------------------------------
  [/\bwand\b/, "gem-staff-1"],
  [/potion|elixir|philter|philtre/, "potion-normal-1"],
  [/\bbrew\b/, "special-brew-1"],
  [/\boil\b/, "flask-full-2"],
  [/\bwine\b|\bbottle\b/, "wine-bottle"],
  [/flask|vial|phial|\bjars?\b/, "flask-full-1"],
  [/\bale\b|\bbeer\b|\bmead\b|tankard|\bmug\b|flagon/, "drink"],
  [/bandage/, "bandage"],
  [/rations?\b|\bmeal\b/, "bread-loaf"],
  [/powder|\bdust\b/, "powder-1"],
  // -- armor & clothing (specific before generic) ----------------------
  [/leather\s*armou?r/, "leather-armour"],
  [/plate\s*(?:mail|armou?r)/, "plate-armour"],
  [/chain\s*mail|chainmail|scale\s*mail|breastplate|cuirass|armou?r/, "iron-armour"],
  [/buckler/, "buckler-shield"],
  [/shield/, "wooden-shield"],
  [/leather\s*helm/, "leather-helm"],
  [/\bhelm\b|helmet/, "barbute-helm"],
  [/(?:steel|iron|metal)\s*gauntlet/, "metal-gauntlet"],
  [/gauntlet|gloves?\b/, "leather-gauntlet"],
  [/boots?\b|shoes?\b/, "leather-boots"],
  [/cloak|\bcape\b|mantle/, "cloak"],
  [/\bbelt\b|girdle/, "belt"],
  [/tunic|shirt|\bvest\b|jerkin/, "blue-tunic"],
  [/trousers|\bpants\b|leggings/, "trousers"],
  [/\bdress\b|\bgown\b|\brobes?\b/, "dress"],
  [/\bhat\b|\bcap\b|\bhood\b/, "robin-hood-hat"],
  // -- jewelry ----------------------------------------------------------
  [/diamond\s*ring/, "diamond-ring"],
  [/\bring\b/, "ring"],
  [/beads|rosary/, "prayer-beads"],
  [/\btorc\b/, "tribal-necklace"],
  [/necklace|amulet|pendant|locket|medallion|brooch|scarab|circlet|tiara|crown|periapt|talisman/, "gold-necklace"],
  // -- weapons ----------------------------------------------------------
  [/greataxe|battle\s*axe|battleaxe|war\s*axe/, "battle-axe"],
  [/hatchet/, "axe"],
  [/\baxe\b/, "war-axe"],
  [/warhammer|hammer/, "hammer"],
  [/\bmace\b|morning\s*star|morningstar|\bclub\b|cudgel/, "spiked-club"],
  [/flail/, "flail"],
  [/\bwhip\b/, "whip"],
  [/katana/, "katana"],
  [/scimitar|sabre|saber|cutlass|falchion|rapier/, "saber"],
  [/shortsword|short\s*sword|gladius/, "gladius"],
  [/(?:magic|enchanted|flaming|frost|rune)\s*(?:sword|blade)|magic\s*weapon/, "enchanted-sword"],
  [/sword|\bblade\b/, "longsword"],
  [/dagger|\bknife\b|\bdirk\b|stiletto|\bkris\b/, "dagger"],
  [/\bsai\b/, "sai"],
  [/crossbow/, "crossbow"],
  [/longbow|shortbow|\bbow\b|arrows?\b/, "bow-and-arrow"],
  [/\bsling\b|slingshot/, "slingshot"],
  [/boomerang/, "boomerang"],
  [/staff|\bstave\b/, "wizard-staff"],
  // -- adventuring gear -------------------------------------------------
  [/backpack|knapsack|rucksack/, "knapsack"],
  [/purse/, "money-purse"],
  [/pouch|\bbag\b|\bsack\b/, "leather-pouch"],
  [/torch/, "torch"],
  [/lantern|\blamp\b/, "lantern"],
  [/candle/, "candle"],
  [/\brope\b/, "rope"],
  [/grappl/, "grappling-hook"],
  [/mirror/, "mirror"],
  [/\bpole\b|\bplank\b|\bbeam\b|lumber/, "wooden-beam"],
  [/(?:brass|iron|gold|silver)?\s*keyring|\bkeys\b/, "silver-keyring"],
  [/\bkey\b/, "brass-key"],
  [/chest|coffer|strongbox|lockbox/, "treasure-chest"],
  [/shackle|manacle|\bchain\b|fetter/, "shackles"],
  [/\bbomb\b|grenade/, "bomb"],
  [/\btrap\b/, "bear-trap"],
  [/hourglass/, "hourglass"],
  [/telescope|spyglass/, "telescope"],
  [/magnifying/, "magnifying-glass"],
  [/shovel|spade/, "shovel"],
  [/pickaxe|\bpick\b/, "pickaxe"],
  [/\btent\b/, "camping-tent"],
  [/basket/, "wicker-basket"],
  [/cauldron/, "cauldron"],
  [/mortar|pestle/, "mortar-and-pestle"],
  [/\bdice\b|\bdie\b/, "dice"],
  [/cards?\b/, "card"],
  // -- instruments ------------------------------------------------------
  [/\blyre\b|\bharp\b/, "lyre"],
  [/violin|fiddle/, "violin"],
  [/\bflute\b/, "flute"],
  [/ocarina/, "ocarina"],
  [/panpipes|\bpipes\b/, "panpipes"],
  [/\bhorn\b/, "war-horn"],
  // -- flora, fauna & sundries -----------------------------------------
  [/herbs?\b/, "herb-1"],
  [/mushroom|toadstool|fungus/, "mushroom"],
  [/flower|blossom/, "flower-bulb"],
  [/\broot\b/, "root-tip"],
  [/seedling|\bseeds?\b/, "pot-seedling"],
  [/idol|statue|statuette|sculpture|figurine|totem|runestone|\brune\b/, "runestone"],
  [/skull/, "skull-and-bones"],
  [/feathers?\b|plume/, "feathers"],
  [/pelt|\bfur\b|\bhide\b/, "pelts"],
  [/\bclaw\b|talon|\bfang\b/, "monster-claw"],
  [/\bwool\b|\byarn\b/, "yarn"],
  [/\bcloth\b|fabric|\bsilk\b|linen/, "cloth"],
  [/cotton/, "cotton"],
  [/\bore\b/, "ore"],
  [/ingot|gold\s*bar/, "gold"],
  [/firewood|\bwood\b/, "wood"],
  [/\bstone\b|\brock\b/, "stone"],
  [/fossil/, "fossil"],
  [/\bhorse\b|\bpony\b|\bmule\b/, "horse"],
  [/fishing\s*rod/, "fishing-rod"],
  [/\beel\b/, "eel"],
  [/octopus/, "octopus"],
  [/turtle/, "turtle"],
  [/jellyfish/, "jellyfish"],
  [/\bfish\b|trout/, "lake-trout"],
  [/\borbs?\b|sphere|\bglobe\b/, "orb-1"],
  // -- food -------------------------------------------------------------
  [/\bbread\b|loaf|baguette/, "bread-loaf"],
  [/cheese/, "cheese"],
  [/\bsteak\b|\bmeat\b|\bbeef\b/, "steak"],
  [/\bham\b|\bpork\b/, "ham"],
  [/chicken/, "chicken-leg"],
  [/\beggs?\b/, "eggs"],
  [/\bmilk\b/, "milk"],
  [/honey/, "honey"],
  [/\bsalt\b/, "salt"],
  [/spices?\b/, "spices"],
  [/\bcandy\b|sweets?\b/, "candy"],
  [/\bcake\b/, "cake"],
  [/apple/, "apple"],
  [/grapes?\b/, "grapes"],
  [/garlic/, "garlic"],
  // -- coins & treasure -------------------------------------------------
  [/silver\s*(?:coins?|pieces?)/, "coins-silver"],
  [/copper\s*(?:coins?|pieces?)/, "coins-bronze"],
  [/coins?\b|\bgp\b|gold\s*pieces?/, "coins-gold"],
  [/\bgems?\b|jewel|diamond|emerald|sapphire|\bruby\b|pearl|\bopal\b|amber|\bjade\b|crystal|topaz|garnet|amethyst|onyx/, "gems"],
];

/**
 * Best Shikashi icon for an item name, or null when nothing fits
 * (callers fall back to their own defaults).
 */
export function pickShikashiIcon(text) {
  const s = String(text ?? "").toLowerCase();
  for (const [re, slug] of RULES) if (re.test(s)) return shikashiIcon(slug);
  return null;
}
