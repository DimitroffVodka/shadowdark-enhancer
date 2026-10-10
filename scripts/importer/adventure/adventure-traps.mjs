/**
 * Shadowdark Enhancer — where an adventure's traps sit on its map, and what each one does.
 *
 * Positions and mechanics only, like the pins (adventure-layouts.mjs) and the walls (adventure-walls.mjs). No book text
 * ships: a trap's own effect text is read out of the GM's book when the scene is built (traps/trap-core.mjs parseTrapText)
 * where the data says which line it is, and is left blank otherwise. The entries are captured from the GM's reviewed
 * scenes (tools/adventure-review/capture.mjs), so a fresh import builds each trap where the review left it.
 *
 *   pin     the area number the trap belongs to (null for a hazard drawn by hand with no number)
 *   nth     a number: which of that area's trap lines it is (1 for the first), as trapCandidates counts them in book order,
 *           and the line its effect is read from. Otherwise the trap's own key, so a re-run finds the Region it made
 *   dc      the DC the book prints for the check, as a sanity check: a line that does not carry it is not the line this
 *           data was made for (a different edition of the book), and its text is not used
 *   trap    what the trap does: name, check, damage, how it fires, whether it holds (the Trap behavior's fields)
 *   box     the area as a plain rectangle [x, y, width, height], fractions of the map
 *   shape   the area as a polygon of [x, y] fractions of the map; `shapes` for an area of several polygons
 *   radius  (an entry without `trap` or an area) how many squares around the pin the trap reaches along walkable floor; its
 *           mechanics are then read from the book line alone, and the trap is skipped when that line is missing
 *   when    (an entry without `trap`) how the trap fires, for one the words do not tell
 *   disabled  true for a trap the GM switched off in the review: it is built switched off
 */
import { parseTrapText } from "../../traps/trap-core.mjs";
import { stripBold } from "../pdf-text-utils.mjs";

export const ADVENTURE_TRAPS = {
  // The Hideous Halls of Mugdulblub
  "cs1-mugdulblub": [
    { pin: 2, nth: 1, dc: 12, box: [0.77944, 0.13697, 0.03083, 0.04766], trap: { trap: "Acid Quicksand", checkAbility: "dex", checkDc: 12, damage: "1d4", when: "round", holds: true } },
    { pin: 3, nth: 2, dc: 15, box: [0.73528, 0.06827, 0.08833, 0.04551], trap: { trap: "Poison Gas", checkAbility: "con", checkDc: 15, damage: "1d4", when: "manual", holds: true } },
    { pin: 13, nth: 1, dc: 12, box: [0.32917, 0.11078, 0.03083, 0.04766], trap: { trap: "Acid Quicksand", checkAbility: "dex", checkDc: 12, damage: "1d4", when: "round", holds: true } },
    { pin: 20, nth: 1, dc: 12, box: [0.0425, 0.63632, 0.03083, 0.04766], trap: { trap: "Acid Quicksand", checkAbility: "dex", checkDc: 12, damage: "1d4", when: "round", holds: true } },
    { pin: 28, nth: 1, dc: 12, box: [0.79417, 0.84113, 0.04417, 0.06827], trap: { trap: "Acid Shrine", checkAbility: "con", checkDc: 12, damage: "1d4", when: "manual", holds: false } },
  ],
  // Fortress of the Burning Brothers: The Iron Fortress
  "cs2-iron-fortress": [
    { pin: 1, nth: "review4", box: [0.45139, 0.87143, 0.04583, 0.07143], trap: { trap: "Magma River", checkAbility: "none", checkDc: 12, damage: "5d10", when: "round", holds: false } },
    { pin: 3, nth: "review5", box: [0.58889, 0.85714, 0.02222, 0.02857], trap: { trap: "Magma Gout", checkAbility: "dex", checkDc: 12, damage: "3d8", when: "manual", holds: false } },
    { pin: 4, nth: "review1", shape: [[0.59889, 0.25], [0.59833, 0.26429], [0.5975, 0.27857], [0.59417, 0.29286], [0.59111, 0.30714], [0.58472, 0.32143], [0.57667, 0.33571], [0.56889, 0.35], [0.55861, 0.36429], [0.54917, 0.37857], [0.53778, 0.39286], [0.52611, 0.40714], [0.5125, 0.42143], [0.50278, 0.43571], [0.4925, 0.45], [0.48167, 0.46429], [0.47306, 0.47857], [0.47167, 0.48214], [0.49583, 0.48214], [0.52639, 0.47857], [0.53722, 0.46429], [0.54333, 0.45], [0.56139, 0.43571], [0.57306, 0.42143], [0.58028, 0.40714], [0.59, 0.39286], [0.60028, 0.37857], [0.60889, 0.36429], [0.615, 0.35], [0.62389, 0.33571], [0.63028, 0.32143], [0.63583, 0.30714], [0.63861, 0.29286], [0.64306, 0.27857], [0.64667, 0.26429], [0.64861, 0.25]], trap: { trap: "Magma River", checkAbility: "none", checkDc: 12, damage: "5d10", when: "round", holds: false } },
    { pin: 4, nth: "review2", shape: [[0.49972, 0.54643], [0.44944, 0.56071], [0.44833, 0.575], [0.44611, 0.58929], [0.44444, 0.60357], [0.44389, 0.61786], [0.44444, 0.63214], [0.44694, 0.64643], [0.44861, 0.66071], [0.44944, 0.675], [0.44917, 0.68929], [0.44861, 0.70357], [0.44667, 0.71786], [0.44639, 0.73214], [0.44694, 0.74643], [0.44778, 0.76071], [0.4475, 0.775], [0.44722, 0.77857], [0.49028, 0.77857], [0.49083, 0.775], [0.48917, 0.76071], [0.4875, 0.74643], [0.48639, 0.73214], [0.48944, 0.71786], [0.48944, 0.70357], [0.48944, 0.68929], [0.49028, 0.675], [0.49167, 0.66071], [0.48972, 0.64643], [0.48972, 0.63214], [0.49028, 0.61786], [0.48972, 0.60357], [0.49167, 0.58929], [0.49389, 0.575], [0.49806, 0.56071], [0.50194, 0.54643]], trap: { trap: "Magma River", checkAbility: "none", checkDc: 12, damage: "5d10", when: "round", holds: false } },
    { pin: 6, nth: "review6", box: [0.64333, 0.68929, 0.02222, 0.02857], trap: { trap: "Gold Dust Ring", checkAbility: "none", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 12, nth: "review3", box: [0.59722, 0.04286, 0.05139, 0.05357], trap: { trap: "Magma River", checkAbility: "none", checkDc: 12, damage: "5d10", when: "round", holds: false } },
    { pin: 15, nth: "review8", box: [0.15694, 0.33929, 0.06528, 0.02857], trap: { trap: "Fire Curtain", checkAbility: "none", checkDc: 12, damage: "4d6", when: "enter", holds: false } },
  ],
  // Fortress of the Burning Brothers: The Mines
  "cs2-mines": [
    { pin: 20, nth: "review1", box: [0.31528, 0.29963, 0.01528, 0.04779], trap: { trap: "Forge Grate", checkAbility: "dex", checkDc: 12, damage: "2d6", when: "manual", holds: false } },
    { pin: 20, nth: "review2", box: [0.35611, 0.29963, 0.01806, 0.04779], trap: { trap: "Forge Grate", checkAbility: "dex", checkDc: 12, damage: "2d6", when: "manual", holds: false } },
    { pin: 20, nth: "review3", box: [0.40472, 0.29963, 0.01528, 0.04779], trap: { trap: "Forge Grate", checkAbility: "dex", checkDc: 12, damage: "2d6", when: "manual", holds: false } },
    { pin: 20, nth: "review4", box: [0.44639, 0.29963, 0.01667, 0.04779], trap: { trap: "Forge Grate", checkAbility: "dex", checkDc: 12, damage: "2d6", when: "manual", holds: false } },
    { pin: null, nth: "hand1", shapes: [[[0.4, 0.35515], [0.40944, 0.35882], [0.41444, 0.36544], [0.41444, 0.36985], [0.42167, 0.37647], [0.44611, 0.37941], [0.45111, 0.38603], [0.44833, 0.39118], [0.45167, 0.38676], [0.46167, 0.39559], [0.47111, 0.41103], [0.47111, 0.42132], [0.46833, 0.425], [0.46611, 0.42206], [0.46333, 0.43015], [0.46444, 0.4375], [0.46833, 0.43824], [0.47833, 0.45147], [0.49056, 0.45882], [0.50222, 0.47132], [0.52, 0.49926], [0.52444, 0.51103], [0.52778, 0.52279], [0.525, 0.52647], [0.52, 0.52132], [0.52833, 0.53088], [0.53278, 0.52941], [0.55167, 0.54412], [0.57389, 0.55294], [0.59333, 0.57868], [0.60778, 0.61103], [0.60889, 0.62574], [0.60667, 0.63603], [0.60889, 0.64485], [0.61167, 0.64265], [0.61444, 0.64632], [0.62222, 0.6625], [0.62056, 0.66912], [0.62389, 0.66765], [0.63889, 0.68162], [0.62389, 0.70588], [0.61278, 0.68824], [0.59833, 0.67059], [0.59611, 0.67353], [0.59111, 0.66544], [0.59, 0.65368], [0.58444, 0.64191], [0.58, 0.60662], [0.57444, 0.59338], [0.57667, 0.58897], [0.555, 0.57206], [0.55056, 0.57647], [0.515, 0.55441], [0.49556, 0.51397], [0.46444, 0.46985], [0.46667, 0.46691], [0.46278, 0.46029], [0.44278, 0.45735], [0.43611, 0.46029], [0.42944, 0.47059], [0.42278, 0.46912], [0.405, 0.47353], [0.39944, 0.46912], [0.39611, 0.47353], [0.38167, 0.47647], [0.37722, 0.475], [0.37444, 0.47132], [0.37556, 0.46838], [0.36833, 0.46324], [0.37, 0.46691], [0.36722, 0.47059], [0.36056, 0.46912], [0.35111, 0.45956], [0.35333, 0.45662], [0.35056, 0.45441], [0.34833, 0.46029], [0.33944, 0.46029], [0.335, 0.45882], [0.33167, 0.45], [0.32833, 0.45588], [0.31778, 0.44485], [0.32, 0.43897], [0.31556, 0.42868], [0.31667, 0.40515], [0.31444, 0.40221], [0.32056, 0.39559], [0.32389, 0.39853], [0.32556, 0.39485], [0.32333, 0.39191], [0.33167, 0.38088], [0.33611, 0.38382], [0.34278, 0.37941], [0.34722, 0.36471], [0.37056, 0.37353], [0.37722, 0.36176], [0.39389, 0.36618], [0.39444, 0.36103]], [[0.90889, 0.33015], [0.91667, 0.34191], [0.91333, 0.35221], [0.91778, 0.37279], [0.91556, 0.38309], [0.92111, 0.38603], [0.92667, 0.39779], [0.92444, 0.40221], [0.93, 0.4125], [0.93, 0.41691], [0.92556, 0.41985], [0.92333, 0.43162], [0.92556, 0.43897], [0.91778, 0.46544], [0.92, 0.5125], [0.91, 0.5375], [0.895, 0.55588], [0.88944, 0.55735], [0.88611, 0.55294], [0.88444, 0.55515], [0.88667, 0.55809], [0.88389, 0.56176], [0.875, 0.56618], [0.86611, 0.56176], [0.86056, 0.56912], [0.85278, 0.56471], [0.84722, 0.56618], [0.845, 0.57206], [0.84056, 0.57353], [0.81722, 0.58088], [0.81167, 0.57794], [0.80778, 0.58309], [0.80889, 0.58603], [0.80167, 0.59412], [0.79833, 0.59412], [0.78889, 0.61103], [0.76667, 0.67574], [0.76389, 0.67941], [0.76167, 0.67647], [0.75167, 0.68676], [0.74611, 0.70147], [0.72278, 0.72353], [0.70944, 0.72941], [0.70278, 0.73824], [0.69722, 0.73971], [0.67944, 0.73971], [0.66167, 0.73382], [0.65889, 0.73015], [0.66, 0.72574], [0.675, 0.70294], [0.68611, 0.70588], [0.68889, 0.70956], [0.68722, 0.71324], [0.70278, 0.71324], [0.70889, 0.70809], [0.70667, 0.70515], [0.70944, 0.70147], [0.735, 0.67794], [0.73722, 0.68088], [0.74278, 0.67794], [0.75444, 0.65809], [0.76556, 0.63015], [0.76667, 0.62279], [0.76333, 0.61691], [0.76556, 0.60956], [0.77222, 0.60515], [0.76889, 0.60074], [0.77, 0.59632], [0.785, 0.57353], [0.79167, 0.575], [0.80944, 0.56029], [0.815, 0.56029], [0.81722, 0.55294], [0.82167, 0.55441], [0.825, 0.55], [0.845, 0.54853], [0.84833, 0.54559], [0.85722, 0.54853], [0.87056, 0.54706], [0.88278, 0.54265], [0.89111, 0.53456], [0.88889, 0.53162], [0.89667, 0.52132], [0.90111, 0.50956], [0.90111, 0.47279], [0.90667, 0.46838], [0.91556, 0.4375], [0.91556, 0.42721], [0.90111, 0.39779], [0.89778, 0.38456], [0.90111, 0.37574], [0.90222, 0.34779], [0.9, 0.34485]]], trap: { trap: "Magma", checkAbility: "none", checkDc: 12, damage: "5d10", when: "round", holds: false } },
  ],
  // Hoard of the Sea Wolf King
  "cs3-sea-wolf": [
    { pin: 14, nth: "review3", box: [0.94222, 0.11373, 0.01472, 0.02275], trap: { trap: "Thor's Lightning", checkAbility: "dex", checkDc: 12, damage: "2d6", when: "manual", holds: false } },
    { pin: 15, nth: "review4", box: [0.69167, 0.14592, 0.03056, 0.09442], trap: { trap: "Collapsing Debris", checkAbility: "dex", checkDc: 12, damage: "2d6", when: "manual", holds: false } },
  ],
  // Basilisk Cult
  "cs4-basilisk-cult": [
    { pin: 7, nth: "review1", box: [0.53333, 0.37917, 0.06667, 0.07917], trap: { trap: "Dancing Gong", checkAbility: "cha", checkDc: 12, damage: "", when: "manual", holds: false, applyDamage: false } },
  ],
  // The Black Seed
  "cs4-black-seed": [
    { pin: 3, nth: "review3", box: [0.74762, 0.52346, 0.05714, 0.05926], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 3, nth: "review4", box: [0.60952, 0.58765, 0.07381, 0.05926], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 3, nth: "review5", box: [0.70714, 0.59753, 0.09286, 0.08889], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 3, nth: "review6", box: [0.83333, 0.63951, 0.09762, 0.11111], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 3, nth: "review7", box: [0.54286, 0.68889, 0.05714, 0.09383], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 3, nth: "review8", box: [0.63571, 0.73333, 0.04524, 0.07901], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 3, nth: "review9", box: [0.82619, 0.77531, 0.0381, 0.05926], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 3, nth: "review10", box: [0.76905, 0.80247, 0.09048, 0.15062], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 3, nth: "review11", box: [0.60952, 0.85926, 0.1381, 0.09877], trap: { trap: "Ice Patch", checkAbility: "dex", checkDc: 12, damage: "", when: "enter", holds: false } },
  ],
  // Black Ziggurat
  "cs4-black-ziggurat": [
    { pin: 1, nth: "review1", box: [0.66667, 0.12708, 0.08889, 0.05833], trap: { trap: "Razor Stairs", checkAbility: "dex", checkDc: 12, damage: "1d4", when: "round", holds: false } },
    { pin: 2, nth: "review2", box: [0.24444, 0.12708, 0.08889, 0.05833], trap: { trap: "Razor Stairs", checkAbility: "dex", checkDc: 12, damage: "1d4", when: "round", holds: false } },
    { pin: 9, nth: "review5", box: [0.45741, 0.81667, 0.11111, 0.0625], trap: { trap: "The Nexus", checkAbility: "none", checkDc: 12, damage: "", when: "manual", holds: false, applyDamage: false } },
  ],
  // Chanichu
  "cs4-chanichu": [
    { pin: 1, nth: "review5", shape: [[0.18894, 0.95152], [0.18894, 0.94455], [0.31121, 0.80561], [0.42227, 0.72227], [0.5, 0.61121], [0.55561, 0.57788], [0.63894, 0.56394], [0.71667, 0.60561], [0.77788, 0.66667], [0.80561, 0.75], [0.81667, 0.86121], [0.85561, 0.94455], [0.85561, 0.95152]], trap: { trap: "Lava", checkAbility: "none", checkDc: 12, damage: "3d10", when: "round", holds: false } },
    { pin: 4, nth: "review1", box: [0.23667, 0.45455, 0.04545, 0.04545], trap: { trap: "Weak Floor", checkAbility: "dex", checkDc: 12, damage: "3d10", when: "enter", holds: false } },
    { pin: 9, nth: "review2", box: [0.37348, 0.36848, 0.04545, 0.04545], trap: { trap: "Weak Floor", checkAbility: "dex", checkDc: 12, damage: "3d10", when: "enter", holds: false } },
  ],
  // Flooded Ruins
  "cs4-flooded-ruins": [
    { pin: 3, nth: "review1", box: [0.58333, 0.3871, 0.04167, 0.19355], trap: { trap: "Grasping Vines", checkAbility: "str", checkDc: 15, damage: "", when: "enter", holds: false } },
  ],
  // Tsibalba
  "cs4-tsibalba": [
    { pin: 6, nth: "review1", box: [0.45, 0.52632, 0.05, 0.05263], trap: { trap: "Lava Gout", checkAbility: "dex", checkDc: 15, damage: "3d8", when: "manual", holds: false } },
    { pin: 7, nth: "review2", box: [0.35, 0.73684, 0.2, 0.05263], trap: { trap: "Lava Pool", checkAbility: "none", checkDc: 12, damage: "5d10", when: "round", holds: false } },
  ],
  // The Ghoulish Library of Leng: Level 1
  "cs5-leng-1": [
    { pin: 14, nth: "review2", box: [0.95475, 0.45776, 0.01525, 0.04794], trap: { trap: "Barbed Glass Portcullis", checkAbility: "con", checkDc: 15, damage: "", when: "manual", holds: false } },
    { pin: 15, nth: "review3", box: [0.89075, 0.80196, 0.01525, 0.02397], trap: { trap: "Barbed Glass Lever", checkAbility: "con", checkDc: 15, damage: "", when: "manual", holds: false } },
    { pin: 27, nth: "review5", box: [0.04575, 0.88684, 0.01525, 0.02397], trap: { trap: "Altar of Terror", checkAbility: "cha", checkDc: 15, damage: "", when: "manual", holds: true } },
  ],
  // The Ghoulish Library of Leng: Level 2
  "cs5-leng-2": [
    { pin: 45, nth: "review2", box: [0.1185, 0.60707, 0.01525, 0.02397], trap: { trap: "Acid Bucket Tripwire (north)", checkAbility: "dex", checkDc: 15, damage: "3d6", when: "enter", holds: false } },
    { pin: 45, nth: "review3", box: [0.0725, 0.65855, 0.01525, 0.02397], trap: { trap: "Acid Bucket Tripwire (west)", checkAbility: "dex", checkDc: 15, damage: "3d6", when: "enter", holds: false } },
    { pin: 45, nth: "review4", box: [0.12425, 0.71984, 0.01525, 0.02397], trap: { trap: "Acid Bucket Tripwire (south)", checkAbility: "dex", checkDc: 15, damage: "3d6", when: "enter", holds: false } },
  ],
  // Burial Mound of Kaghan
  "wrma-burial-mound-kaghan": [
    { pin: 2, nth: "review1", box: [0.35714, 0.61746, 0.03571, 0.04603], trap: { trap: "Poison Needles", checkAbility: "con", checkDc: 15, damage: "", when: "manual", holds: false } },
    { pin: 5, nth: "review2", box: [0.82143, 0.47619, 0.07143, 0.04762], trap: { trap: "Hallucination Gas", checkAbility: "con", checkDc: 15, damage: "", when: "manual", holds: false } },
  ],
  // Chapel of the Plague Priestesses
  "wrma-chapel-plague-priestesses": [
    { pin: 4, nth: "review1", box: [0.59321, 0.555, 0.07099, 0.09], trap: { trap: "Pit Trap", checkAbility: "dex", checkDc: 12, damage: "2d6", when: "enter", holds: true } },
    { pin: 9, nth: "review2", shape: [[0.81667, 0.35833], [0.9216, 0.35833], [0.9216, 0.49667], [0.88889, 0.49667], [0.88889, 0.44667], [0.85185, 0.44667], [0.85185, 0.49667], [0.81667, 0.49667]], trap: { trap: "Corpse Pit", checkAbility: "dex", checkDc: 12, damage: "2d6", when: "enter", holds: false } },
  ],
  // Fallen Keep of the Emerald Knight
  "wrma-fallen-keep-emerald-knight": [
    { pin: 4, nth: "review1", box: [0.84303, 0.12413, 0.04545, 0.04762], trap: { trap: "Dizzying Vines", checkAbility: "con", checkDc: 12, damage: "", when: "enter", holds: false } },
    { pin: 7, nth: "review2", box: [0.56212, 0.14762, 0.07273, 0.0373], trap: { trap: "Tabernacle Swamp Gas", checkAbility: "con", checkDc: 12, damage: "1d4", when: "manual", holds: false } },
  ],
  // Forge of the Metallic Sisters
  "wrma-forge-metallic-sisters": [
    { pin: 7, nth: "review3", shape: [[0.27991, 0.29238], [0.33426, 0.21976], [0.33426, 0.28655], [0.5, 0.28655], [0.5, 0.22321], [0.55241, 0.28929], [0.55241, 0.46524], [0.47639, 0.56655], [0.35898, 0.56655], [0.27991, 0.46381]], trap: { trap: "Lava Sea", checkAbility: "none", checkDc: 12, damage: "5d10", when: "round", holds: false } },
  ],
  // Grotto of the Golden Swan
  "wrma-grotto-golden-swan": [
    { pin: 4, nth: "review2", box: [0.31061, 0.75167, 0.04545, 0.05], trap: { trap: "Rock Fall", checkAbility: "dex", checkDc: 12, damage: "1d4", when: "enter", holds: false } },
    { pin: 6, nth: "review1", box: [0.89288, 0.19767, 0.04545, 0.05], trap: { trap: "Rock Fall", checkAbility: "dex", checkDc: 12, damage: "1d4", when: "enter", holds: false } },
    { pin: 6, nth: "review3", box: [0.81742, 0.1, 0.04545, 0.05], trap: { trap: "False Golden Eggs", checkAbility: "dex", checkDc: 12, damage: "1d6", when: "manual", holds: false } },
  ],
  // House of Rogues
  "wrma-house-of-rogues": [
    { pin: 7, nth: "review1", box: [0.679, 0.25444, 0.03333, 0.05556], trap: { trap: "Enchanted Manacles", checkAbility: "dex", checkDc: 15, damage: "", when: "manual", holds: true } },
  ],
};

/**
 * Whether the importer places these traps on a scene: the build, the placer's Add traps button and
 * `game.shadowdarkEnhancer.traps.placeAdventure()` all use the data above while it is on.
 */
export const PLACE_ADVENTURE_TRAPS = true;

export const trapsFor = (siteId) => (PLACE_ADVENTURE_TRAPS ? ADVENTURE_TRAPS[siteId] : null) ?? null;

/** Flag on every region this module made from this data, so a run can tell its own traps from the GM's. */
export const TRAP_REGION_FLAG = "adventureTrap";

/**
 * A line that opens with a label the books put in front of a hazard ("Floor.", "Trap.", "River."). A "Door." or "Wall." line is a lock
 * or a barrier with a DC, not a trap, so it is not a candidate: counting it would move every `nth` after it.
 */
const LABELLED = /^(?:trap|floor|ceiling|stalagmites?|rock pillar|river)\b/i;
/** ...and talks like one: a DC, the word trap, damage each round. */
const TRAPISH = /\bDC\s*\d+|\btrap\b|damage\/round|\bper round\b/i;

/**
 * Pure: the lines of an area that may be traps, in book order. Counting them the same way when the data was made and when a
 * GM imports is what ties `nth` to a line, so this is the one definition of "a candidate".
 * @param {Array<{kind:string, text:string}>} blocks  bodyBlocks of the area
 * @returns {string[]} plain text of each candidate
 */
export function trapCandidates(blocks) {
  return (blocks ?? [])
    .filter((b) => b.kind === "li")
    .map((b) => stripBold(b.text).replace(/\s+/g, " ").trim())
    .filter((text) => LABELLED.test(text) && TRAPISH.test(text));
}

/**
 * Pure: the outline of a set of squares as polygon shapes: one polygon around each connected patch, so a trap's area is one
 * shape a GM can reshape by its corners, not a stack of rectangles. A patch with a gap inside it (a pillar) also gets the gap
 * as a `hole` polygon, listed after the outlines.
 * @param {Array<[number, number]>} squares  [column, row]
 * @param {{x:number, y:number}} rect  the scene's image area
 * @param {number} gridSize
 */
export function squareOutline(squares, rect, gridSize) {
  const cells = new Set(squares.map(([c, r]) => `${c},${r}`));
  const has = (c, r) => cells.has(`${c},${r}`);
  // Each square's sides that face nothing, directed so the square is on the right (clockwise on screen); two squares' shared side cancels.
  const out = new Map();
  const add = (x1, y1, x2, y2) => { const k = `${x1},${y1}`; (out.get(k) ?? out.set(k, []).get(k)).push([x2, y2]); };
  for (const [c, r] of squares) {
    if (!has(c, r - 1)) add(c, r, c + 1, r);
    if (!has(c + 1, r)) add(c + 1, r, c + 1, r + 1);
    if (!has(c, r + 1)) add(c + 1, r + 1, c, r + 1);
    if (!has(c - 1, r)) add(c, r + 1, c, r);
  }
  const loops = [];
  for (const [startKey] of out) {
    while (out.get(startKey)?.length) {
      const start = startKey.split(",").map(Number), ring = [start];
      let at = start;
      for (;;) {
        const next = out.get(`${at}`)?.pop();
        if (!next) break;
        if (next[0] === start[0] && next[1] === start[1]) break;
        ring.push(next);
        at = next;
      }
      // Drop a corner that is not one: three points in a line.
      const kept = ring.filter((p, i) => {
        const a = ring[(i + ring.length - 1) % ring.length], b = ring[(i + 1) % ring.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      if (kept.length >= 3) loops.push(kept);
    }
  }
  // Clockwise on screen (the shoelace sum is positive) is an outline; anticlockwise is a gap.
  const area = (ring) => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + (p[0] * q[1] - q[0] * p[1]); }, 0);
  const shape = (ring) => ({
    type: "polygon", hole: area(ring) < 0,
    points: ring.flatMap(([x, y]) => [rect.x + x * gridSize, rect.y + y * gridSize]),
  });
  return [...loops.filter((r) => area(r) > 0), ...loops.filter((r) => area(r) < 0)].map(shape);
}

/**
 * Pure: an entry's area in scene pixels: its `box` as a rectangle, its `shape` as a polygon, or each of its `shapes` as a polygon.
 * Shared with the stairs and ladders (adventure-links.mjs), whose ends are drawn the same way.
 * @param {{box?:number[], shape?:number[][], shapes?:number[][][]}} e  fractions of the map
 * @param {{x:number, y:number, width:number, height:number}} rect  the scene's image area
 * @returns {object[]} Region shapes; none when the entry has no area of its own
 */
export function regionShapes(e, rect) {
  const at = (u, v) => [Math.round(rect.x + u * rect.width), Math.round(rect.y + v * rect.height)];
  if (e.box) {
    const [u, v, w, h] = e.box;
    const [x, y] = at(u, v);
    return [{ type: "rectangle", x, y, width: Math.round(w * rect.width), height: Math.round(h * rect.height), rotation: 0, hole: false }];
  }
  return (e.shapes ?? (e.shape ? [e.shape] : [])).map((poly) => ({ type: "polygon", points: poly.flatMap(([u, v]) => at(u, v)), hole: false }));
}

/**
 * Pure: the traps to make on a scene.
 * @param {object} args
 * @param {Array<{pin:number|null, nth:number|string, dc?:number, radius?:number, when?:string, trap?:object}>} args.entries  the shipped data for the site
 * @param {Record<number, string[]>} args.texts  trapCandidates per area number, read from the GM's book
 * @param {Record<number, {x:number, y:number}>} args.pins  the scene's pins, in scene pixels
 * @param {{x:number, y:number, width:number, height:number}} args.rect  the scene's image area
 * @param {number} args.gridSize
 * @param {(pin:{x:number, y:number}) => Array<[number, number, number?]>} args.squaresOf  the floor squares reachable from a pin as [column, row, steps walked from the pin]
 * @returns {{traps: Array<{pin:number, nth:number, name:string, system:object, shapes:object[], disabled?:boolean}>, skipped: Array<{pin:number, nth:number, why:"text"|"dc"|"pin"|"floor"}>}}
 */
export function planSiteTraps({ entries, texts, pins, rect, gridSize, squaresOf }) {
  const traps = [], skipped = [];
  for (const e of entries ?? []) {
    const skip = (why) => skipped.push({ pin: e.pin, nth: e.nth, why });
    const text = Number.isInteger(e.nth) ? texts?.[e.pin]?.[e.nth - 1] : undefined;
    if (e.trap) {
      // What the trap does ships; only its effect is the book's, and only when the line is the one the data was made for.
      const read = text ? parseTrapText(text) : null;
      const fits = read && (e.dc === undefined || (read.checkAbility !== "none" && read.checkDc === e.dc));
      const name = e.pin ? `${e.pin}. ${e.trap.trap}` : e.trap.trap;
      traps.push({ pin: e.pin, nth: e.nth, name, system: { trigger: "", effect: fits ? read.effect : "", ...e.trap }, shapes: regionShapes(e, rect), disabled: !!e.disabled });
      continue;
    }
    if (!text) { skip("text"); continue; }
    const record = parseTrapText(text);
    if (e.dc !== undefined && !(record.checkAbility !== "none" && record.checkDc === e.dc)) { skip("dc"); continue; }
    let shapes = regionShapes(e, rect);
    if (!shapes.length) {
      const pin = pins?.[e.pin];
      if (!pin) { skip("pin"); continue; }
      const pc = Math.floor((pin.x - rect.x) / gridSize), pr = Math.floor((pin.y - rect.y) / gridSize);
      const reach = e.radius ?? 2;
      // Near in a straight line AND on foot (twice the radius at most): a square on the far side of a thin wall is not in the room.
      const squares = squaresOf(pin).filter(([c, r, steps]) => Math.hypot(c - pc, r - pr) <= reach && (steps === undefined || steps <= 2 * reach));
      if (!squares.length) { skip("floor"); continue; }
      shapes = squareOutline(squares, rect, gridSize);
    }
    const system = { ...record, ...(e.when ? { when: e.when } : {}) };
    traps.push({ pin: e.pin, nth: e.nth, name: `${e.pin}. ${record.trap || "Trap"}`, system, shapes });
  }
  return { traps, skipped };
}
