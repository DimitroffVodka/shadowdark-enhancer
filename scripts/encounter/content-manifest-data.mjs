/**
 * Shadowdark Enhancer — Content Manifests (DRAFT, Phase 24)
 *
 * Content-FREE catalogs of what each Cursed Scroll contains, so the Monsters /
 * Items / Journal / Scenes dashboards can show "in system / imported / missing"
 * the way the Tables tab does. Names + sources + approximate pages ONLY — no
 * statblocks, no item text, no map images (same copyright stance as
 * TABLE_MANIFEST).
 *
 * ⚠️ DRAFT: bootstrapped 2026-06-17 from `.planning/CS-CONTENT-INVENTORY.md`,
 * which is itself approximate (page ranges, "~" counts, mixed statblock/NPC
 * lists). Entries carry `draft: true` and the UI flags them. Refine names and
 * pages against the books over time; this is a starting to-do list, not an
 * authoritative index.
 */

const L = { cs1: "Cursed Scroll 1", cs2: "Cursed Scroll 2", cs3: "Cursed Scroll 3",
            cs4: "Cursed Scroll 4", cs5: "Cursed Scroll 5", cs6: "Cursed Scroll 6" };
const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const mk = (source, category, page, name) =>
  ({ id: `${source}-${kebab(name)}`, name, source, sourceLabel: L[source], category, page, draft: true });

// ── Monsters: statblock creatures + named NPCs ───────────────────────────────
export const MONSTER_MANIFEST = [
  // CS1 — Diablerie (monster ch. pg 45–49)
  ...["Bittermold","Gordock Breeg","Bogthorn","Dralech","Hexling","Howler","Ichor Ooze",
      "Marrow Fiend","Skrell","Tar Bat","The Willowman","Knight of St. Ydris"].map(n => mk("cs1","Monster",45,n)),
  ...["Drusilla","Barbarog","Victoria","Greaves Redthorne","Unduluk","Haldrin","Ixidian",
      "Titania","Torak Bain","Taigolar","Inquisitor Justinia Morvin","St. Ydris"].map(n => mk("cs1","NPC",null,n)),
  // CS2 — Red Sands (monster ch. pg 39–43)
  ...["The Scourge","Dunefiend","Dust Devil","Canyon Ape","Mirage","Ras-Godai","Siruul"].map(n => mk("cs2","Monster",39,n)),
  ...["Nuariel Siruul","The Wolf of Yarin","Tajora","Kadim","Murjana","Delila","Rameer the Lion",
      "Shar Yasmila","Gori-Mannu","Manazusa","Wadim the Crooked","Malchor"].map(n => mk("cs2","NPC",null,n)),
  // CS3 — Midnight Sun (monster ch. ~pg 43–48)
  ...["Greater Drake","Lesser Drake","Sea Serpent","Orca","Giant Bat","Draugr","Dverg","Nord",
      "Oracle","Sea Nymph","Valkyrie","Deep Troll"].map(n => mk("cs3","Monster",43,n)),
  ...["Signe","Egrid","Snorgin Thrain","Mithrandraak","Brugatha","Rogden","Olaf",
      "Torbald the Bloodless","Karsgald","The Norn"].map(n => mk("cs3","NPC",null,n)),
  // CS4 — River of Night (monster ch. pg 59–66; 18/18 already imported)
  ...["Skandrill","Stone Warrior","Stone Shaman","Viperian","Couatl","Skirrim","Basilisk",
      "Giant Ant","Giant Ant Queen"].map(n => mk("cs4","Monster",59,n)),
  ...["Tecuhan","Bretuli","Mictza","Tezoticali","Laurencio","Marigold","Grenne Reskin","Cuzol",
      "Uzaru","Ulesk","Okahara","Rasamiru","Lord Hedron","Istril"].map(n => mk("cs4","NPC",null,n)),
  // CS5 — Dwellers in the Deep (monster ch. pg 33–36)
  ...["Bezelak","Wendel","Morzo Moth","Nuln","Dremir","Librarian of Leng","Aboleth",
      "Rime Walker","Grick","Deep One","Insane Cyclops"].map(n => mk("cs5","Monster",33,n)),
  // CS6 — City of Masks (no monster chapter; faction leaders + d40 NPCs)
  ...["The Shroud","The Duke","Thieves' Guild Leader"].map(n => mk("cs6","NPC",42,n)),
];

// ── Items: named uniques + dedicated gear/spell/poison sets ───────────────────
export const ITEM_MANIFEST = [
  ...["Rot-Ruin","Green Mithral Plate","Ynnith","Emerald Blade","Wand of Moonbeam","Mithral Chainmail"].map(n => mk("cs1","Magic Item",null,n)),
  ...["Skinlasher","Flying Carpet","Sunscorch","Ring of Fireballs","Genie Lamp","Staff of Ord"].map(n => mk("cs2","Magic Item",null,n)),
  // CS2 Desert Poisons (d8 table, pg 27) — expanded to individual entries
  ...["Aminiita Root","Bluewort Paste","Drowsy Dust","Ether of Idos","Kingslayer Oil",
      "Nuzule Oil","Truth-Speak Oil","Vapor of Leng"].map(n => mk("cs2","Poison",27,n)),
  ...["Jotunblad","Jelly Orb"].map(n => mk("cs3","Magic Item",null,n)),
  ...["Rothak","Amulet of Vitality","Circlet of the Catfish","Orb of All-Eyes","Fangs of Oatali",
      "Bag of Badgers","Staff of Healing"].map(n => mk("cs4","Magic Item",null,n)),
  // CS4 New Weapons (pg 15) — Boomerang & Spear-Thrower ship in the system; obsidian set is new
  ...["Boomerang","Spear-Thrower","Obsidian Club","Obsidian Dagger","Obsidian Spear"].map(n => mk("cs4","Weapon",15,n)),
  // CS4 Druid Spells (pg 16) — wizard (N) spell list
  ...["Breath","Instill","Oxidize","Whisperwind","Barkskin","Befriend","Magnetize","Truespeech",
      "Alchemy","Anima","Locusts","Treeshape","Mycelium","Summon Storm","Earthquake","Naming"].map(n => mk("cs4","Spell",16,n)),
  // CS5 New Gear (pg 22)
  ...["Ball Bearing","Candle","Charcoal","Flash Seed","Glow Paste","Holy Water","Lantern Hook",
      "Miner's Putty","Net","Morzo Silk Rope","Tallow","Traveler's Lamp"].map(n => mk("cs5","Gear",22,n)),
  // CS5 Sorcerer Spells (pg 15) — wizard (C) spell list
  ...["Blight","Eyebite","Mischief","Protection From Good","Envenom","Phantoms","Wither","Wrack",
      "Betrayal","Defile","Mazzim's Mesmerism","Unlife","Dismember","Dominate","Feeblemind","Subjugate"].map(n => mk("cs5","Spell",15,n)),
  // CS6 Mage Spells (pg 19) — wizard (L) spell list
  ...["Cleanse","Flare","Reveal","Ward","Absorb","Meld","Pacify","Push/Pull","Banish","Forbid",
      "Identify","Speak With Object","Glyph","Stasis","Abjure","Permanence"].map(n => mk("cs6","Spell",19,n)),
];

// ── Journals: hex/city keys + dungeon keys + rules/class chapters ─────────────
export const JOURNAL_MANIFEST = [
  mk("cs1","Hexcrawl",null,"The Gloaming Hex Key"),
  mk("cs1","Dungeon",50,"Hideous Halls of Mugdulblub"),
  mk("cs2","Hexcrawl",null,"The Djurum Hex Key"),
  mk("cs2","Dungeon",44,"Fortress of the Burning Brothers"),
  mk("cs3","Hexcrawl",null,"The Isles of Andrik Hex Key"),
  mk("cs3","Dungeon",50,"Hoard of the Sea Wolf King"),
  mk("cs4","Hexcrawl",null,"The Black River Hex Key"),
  ...["Army Ants","Basilisk Cult","Black Ziggurat","Chanichu","Eclipse Dial","Flooded Ruins",
      "Star Map Temple","The Black Seed","Tsibalba"].map(n => mk("cs4","Dungeon",40,`${n} Key`)),
  mk("cs5","Hexcrawl",27,"Morzomotha Hex Key"),
  mk("cs5","Dungeon",37,"Ghoulish Library of Leng — Level 1"),
  mk("cs5","Dungeon",52,"Ghoulish Library of Leng — Level 2"),
  mk("cs6","City",null,"City of Masks — 50-Location Index"),
];

// ── Scenes: maps shipped with each scroll (dims where known) ──────────────────
const scene = (source, name, dims) => ({ ...mk(source, "Scene", null, name), dims, draft: true });
export const SCENE_MANIFEST = [
  scene("cs1","The Gloaming Hex Map",null),
  scene("cs1","Ruins of Bittermold Keep","68×44"),
  scene("cs2","The Djurum Hex Map",null),
  scene("cs2","The Iron Fortress","45×35"),
  scene("cs2","The Mines","45×34"),
  scene("cs3","The Isles of Andrik Hex Map",null),
  scene("cs3","Sea Caves and Tombs","68×44"),
  scene("cs3","Wortwick Monastery","28×28"),
  scene("cs4","The Black River — North",null),
  scene("cs4","The Black River — South",null),
  scene("cs4","Army Ants","36×30"),
  scene("cs4","Basilisk Cult","30×24"),
  scene("cs4","Black Ziggurat","18×32"),
  scene("cs4","Chanichu","22×22"),
  scene("cs4","Eclipse Dial","31×24"),
  scene("cs4","Flooded Ruins","24×31"),
  scene("cs4","Star Map Temple","23×21"),
  scene("cs4","The Black Seed","28×27"),
  scene("cs4","Tsibalba","20×19"),
  scene("cs5","Morzomotha Hex Map",null),
  scene("cs5","Library of Leng — Level 1","66×42"),
  scene("cs5","Library of Leng — Level 2","66×42"),
  scene("cs6","City of Masks Map",null),
  ...["Gedgarrin","Gutterwash","High Harbor","Montmar Castle","Ninestones","Rilken Row",
      "Silvertop","The Rooks"].map(n => scene("cs6", `${n} District`, null)),
];
