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
            cs4: "Cursed Scroll 4", cs5: "Cursed Scroll 5", cs6: "Cursed Scroll 6",
            pgwr: "Western Reaches" };
const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const mk = (source, category, page, name) =>
  ({ id: `${source}-${kebab(name)}`, name, source, sourceLabel: L[source], category, page, draft: true });

// ── Monsters: statblock creatures only ───────────────────────────────────────
// Refined to the actual statblock roster per scroll (CS books describe many
// named NPCs in prose with no statblock — those are not catalogued here, since
// there is nothing to import). Names match the imported docs via loose
// (order/punctuation-insensitive) matching, e.g. "Greater Drake" ↔ "Drake, Greater".
export const MONSTER_MANIFEST = [
  // CS1 — Diablerie (monster ch. pg 45)
  ...["Bittermold","Gordock Breeg","Bogthorn","Dralech","Hexling","Howler","Ichor Ooze",
      "Marrow Fiend","Skrell","Tar Bat","The Willowman"].map(n => mk("cs1","Monster",45,n)),
  // CS2 — Red Sands (monster ch. pg 39)
  ...["The Scourge","Dunefiend","Dust Devil","Canyon Ape","Mirage","Ras-Godai","Siruul"].map(n => mk("cs2","Monster",39,n)),
  // CS3 — Midnight Sun (monster ch. pg 43)
  ...["Greater Drake","Lesser Drake","Sea Serpent","Orca","Giant Bat","Draugr","Dverg","Nord",
      "Oracle","Sea Nymph","Valkyrie","Deep Troll"].map(n => mk("cs3","Monster",43,n)),
  // CS4 — River of Night (monster ch. pg 59)
  ...["Skandrill","Stone Warrior","Stone Shaman","Viperian","Couatl","Basilisk","Giant Ant"].map(n => mk("cs4","Monster",59,n)),
  // CS5 — Dwellers in the Deep (monster ch. pg 33)
  ...["Bezelak","Wendel","Morzo Moth","Nuln","Dremir","Librarian of Leng","Aboleth",
      "Rime Walker","Grick","Deep One"].map(n => mk("cs5","Monster",33,n)),
  // ── WR — Player's Guide to the Western Reaches (scraped from the PDF, DRAFT) ──
  // Mounts (pg 114-116), Warband units (pg 248-251), spell-summoned creatures.
  ...[
      "Camel","Silver Camel","Donkey","Elephant",
      "Griffon","Hippogriff","Horse","Prized Horse",
      "War Horse","Moose","Pegasus","Pony",
      "Scrag","War Scrag","Worg"].map(n => mk("pgwr","Monster",114,n)),
  ...[
      "Light Melee Warband","Heavy Melee Warband","Light Mounted Warband","Heavy Mounted Warband",
      "Light Ranged Warband","Heavy Ranged Warband","Berserker Warband","Rabble Warband"].map(n => mk("pgwr","Monster",248,n)),
  ...[
      "Anima","Treant"].map(n => mk("pgwr","Monster",166,n)),
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
  // ── WR — Player's Guide to the Western Reaches (scraped from the PDF, DRAFT) ──
  // Gear (pg 106), Weapons (110), Armor (112), Poisons (113), Boats (118), Siege (119).
  // The Player's Guide reprints the core equipment list, so much of this resolves
  // in-system on reconcile; the boats/siege/mithral set + poisons + new weapons are new.
  ...[
      "Arrows (20)","Backpack","Ball bearing","Bolas",
      "Caltrops (one bag)","Candle (3)","Charcoal, jar","Crossbow bolts (20)",
      "Crowbar","Flash seed","Flask or bottle","Flint and steel",
      "Glow paste, jar","Grappling hook","Holy water, flask","Iron spikes (10)",
      "Lantern","Lantern hook","Miner's putty, jar","Mirror",
      "Net","Oil, flask","Pole","Rations (3)",
      "Rope, 60'","Morzo silk rope","Saddle","Spear-thrower",
      "Tallow, jar","Torch","Traveler's lamp","Wagon"].map(n => mk("pgwr","Gear",106,n)),
  ...[
      "Bastard sword","Blowgun","Boomerang","Chakram",
      "Club","Crossbow","Dagger","Falchion",
      "Greataxe","Greatsword","Handaxe","Javelin",
      "Lance","Longbow","Longsword","Mace",
      "Morningstar","Pike","Rapier","Razor chain",
      "Sai","Scimitar","Shortbow","Shortsword",
      "Shuriken","Sling","Spear","Staff",
      "Stave","Warhammer","Whip"].map(n => mk("pgwr","Weapon",110,n)),
  ...[
      "Leather armor","Chainmail","Mithral chainmail","Plate mail",
      "Mithral plate mail","Round shield","Mithral round shield","Shield",
      "Mithral shield"].map(n => mk("pgwr","Armor",112,n)),
  ...[
      "Aminiita root","Bluewort paste","Drowsy dust","Ether of Idos",
      "Kingslayer oil","Nuzule oil","Truth-speak oil","Vapor of Leng"].map(n => mk("pgwr","Poison",113,n)),
  ...[
      "Canoe","Galleon","Junk","Longboat",
      "Raft","Rowboat","Sailboat","Sloop"].map(n => mk("pgwr","Boat",118,n)),
  ...[
      "Ballista","Catapult","Heavy crossbow","Trebuchet"].map(n => mk("pgwr","Siege Weapon",119,n)),
  // Spells — class lists (pg 122/132/144/150/166). Necromancer/Seer/Witch are largely new;
  // the Wizard set = Druid/Mage/Sorcerer (overlaps CS4/CS5/CS6). Cross-class duplicate names
  // kept once (Speak With Dead→Necromancer, Protection From Good→Priest, Eyebite→Witch).
  ...[
      "First Gate","Protection From Evil","Seal Soul","Turn Undead",
      "Undeath","Withermark","Bane","Command Undead",
      "Final Toll","Ghoul Touch","Lamentation","Second Gate",
      "Animate Dead","Drain Life","Lay To Rest","Reap The Soul",
      "Speak With Dead","Third Gate","Ashes To Ashes","Excoriate",
      "Fourth Gate","Necronomicon","Revenant","Vision",
      "Anchor","Create Undead","Dust To Dust","Fifth Gate",
      "Riverwalk","Summon Soul"].map(n => mk("pgwr","Spell",122,n)),
  ...[
      "Fortify","Prayer","Consecrate","Peace",
      "Covenant","Revitalize","Halo","Wheel of Flames",
      "Death Ward","Rapture","Detect Magic","Thorn",
      "Feast","Regrowth","Dispel Magic","Serpent",
      "Bear Shape","Siphon","Balance","Root",
      "Darkness","Protection From Good","Extract","Inflict Wounds",
      "Blood Rite","Rend","Contagion","Unhinge",
      "Damnation","Harm"].map(n => mk("pgwr","Spell",132,n)),
  ...[
      "Chant","Evoke Rage","Potion","Trance",
      "Fate","Read The Runes","Sacrifice","Soulbind",
      "Cast Out","Hallucinate","Raven","Wolfshape",
      "Freya's Omen","Loki's Trickery","Odin's Wisdom","Thor's Thunder",
      "Ragnarok","Valkyrie","World Serpent","World Tree"].map(n => mk("pgwr","Spell",144,n)),
  ...[
      "Cauldron","Charm Person","Eyebite","Fog",
      "Hypnotize","Oak, Ash, Thorn","Puppet","Shadowdance",
      "Willowman","Witchlight","Alter Self","Augury",
      "Bogboil","Cacklerot","Cat's Eye","Frog Rain",
      "Invisibility","Poison","Spidersilk","Toadstool",
      "Broomstick","Coven","Divination","Howl",
      "Mistletoe","Pin Doll","Swarm","Void Stare",
      "Whisper","Beguile","Cloak of Night","Curse",
      "Dimension Door","Glassbones","Moonbeam","Nightmare",
      "Polymorph","Anathema","Dreamwalk","Enfeeble",
      "Finger of Death","Mother of Night","Scrying","Shapechange",
      "Soul Jar"].map(n => mk("pgwr","Spell",150,n)),
  ...[
      "Breath","Instill","Oxidize","Whisperwind",
      "Barkskin","Befriend","Magnetize","Truespeech",
      "Alchemy","Anima","Locusts","Treeshape",
      "Mycelium","Summon Storm","Earthquake","Naming",
      "Cleanse","Flare","Reveal","Ward",
      "Absorb","Meld","Pacify","Push/Pull",
      "Banish","Forbid","Identify","Speak With Object",
      "Glyph","Stasis","Abjure","Permanence",
      "Blight","Mischief","Envenom","Phantoms",
      "Wither","Wrack","Betrayal","Defile",
      "Mazzim's Mesmerism","Unlife","Dismember","Dominate",
      "Feeblemind","Subjugate"].map(n => mk("pgwr","Spell",166,n)),
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
  mk("cs5","Dungeon",37,"Library of Leng — Level 1 Areas"),
  mk("cs5","Dungeon",52,"Library of Leng — Level 2 Areas"),
  mk("cs6","City",54,"City of Masks — Locations"),
  // ── WR — Player's Guide to the Western Reaches (scraped from the PDF, DRAFT) ──
  // Lore/gazetteer, the 8 deities, 17 patrons, 11 gameplay procedures, 6 factions.
  mk("pgwr","Lore",12,"What Everyone Knows"),
  mk("pgwr","Lore",14,"Life in the Reaches: Points of Light"),
  mk("pgwr","Lore",15,"Life in the Reaches: Social Structure"),
  mk("pgwr","Lore",15,"Civilizations of the Reaches"),
  mk("pgwr","Deity",190,"Madeera the Covenant"),
  mk("pgwr","Deity",192,"Saint Terragnis"),
  mk("pgwr","Deity",194,"Gede"),
  mk("pgwr","Deity",196,"Ord"),
  mk("pgwr","Deity",198,"Memnon"),
  mk("pgwr","Deity",200,"Shune the Vile"),
  mk("pgwr","Deity",202,"Ramlaat"),
  mk("pgwr","Deity",204,"The Lost"),
  mk("pgwr","Patron",206,"Patrons: Overview"),
  mk("pgwr","Patron",207,"Almazzat"),
  mk("pgwr","Patron",208,"Freya"),
  mk("pgwr","Patron",209,"Krraktanamak"),
  mk("pgwr","Patron",210,"Kytheros"),
  mk("pgwr","Patron",211,"Loki"),
  mk("pgwr","Patron",212,"Molek"),
  mk("pgwr","Patron",213,"Mugdulblub"),
  mk("pgwr","Patron",214,"Oatali"),
  mk("pgwr","Patron",215,"Obe-Ixx of Azarumme"),
  mk("pgwr","Patron",216,"Odin"),
  mk("pgwr","Patron",217,"Oros"),
  mk("pgwr","Patron",218,"Rathgamnon"),
  mk("pgwr","Patron",219,"Saint Ydris"),
  mk("pgwr","Patron",220,"Shune the Vile (Patron)"),
  mk("pgwr","Patron",221,"Titania"),
  mk("pgwr","Patron",222,"The Willowman"),
  mk("pgwr","Patron",223,"Yag-Kesh"),
  mk("pgwr","Gameplay",226,"Hex Crawling"),
  mk("pgwr","Gameplay",228,"Climate"),
  mk("pgwr","Gameplay",230,"Camping"),
  mk("pgwr","Gameplay",231,"Fast Travel"),
  mk("pgwr","Gameplay",232,"Travel Procedure"),
  mk("pgwr","Gameplay",233,"Renown"),
  mk("pgwr","Gameplay",234,"Downtime"),
  mk("pgwr","Gameplay",236,"Carousing"),
  mk("pgwr","Gameplay",246,"Bastions"),
  mk("pgwr","Gameplay",248,"Warbands"),
  mk("pgwr","Faction",92,"The Bards"),
  mk("pgwr","Faction",94,"The Jeweled Eye"),
  mk("pgwr","Faction",96,"The Scarlet Bones"),
  mk("pgwr","Faction",98,"The Society"),
  mk("pgwr","Faction",100,"The Torchbearers"),
  mk("pgwr","Faction",102,"The Wolves of Lydonia"),
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
  // ── WR — Player's Guide to the Western Reaches ──────────────────────────────
  // The book ships one overview map (front endpaper); region/hex maps live in the
  // Cursed Scrolls. Map image not extracted (D1 — maps stay outside the repo).
  scene("pgwr","Player's Map of the Western Reaches",null),
];
