/**
 * Shadowdark Enhancer — Table structure seeds (generated 2026-07-10)
 *
 * STRUCTURE ONLY, extracted from the authored gold tables: roll formulas,
 * folder names, SDE flags (manifestId etc.), and TABLE-CHAIN links — by name
 * for suite tables ({ref:{name,pack:"tables"}}), literal uuid for cross-
 * world-stable shadowdark.* docs. Monster/item row links are NOT seeded:
 * TableEnricher restores those by name-match at import. NO book text ships
 * here — the user's paste supplies every word; applyTableStructureSeed()
 * then restores chains and flags on top. Content contract enforced by
 * verify.sh (blocking).
 */

export const TABLE_STRUCTURE_SEEDS = {
"Almazzat Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
2,
2
],
"uuid": "Compendium.shadowdark.talents.Item.6iJ6ETUAKC7DR0aT"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.S4zOvXqPlLLNmGKl"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.UVsf7VJCOrBm42Yz"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.6iJ6ETUAKC7DR0aT"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.S4zOvXqPlLLNmGKl"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.UVsf7VJCOrBm42Yz"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Backgrounds": {
"flags": {
"manifestId": "pgwr-backgrounds",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Barbarian Talents": {
"flags": {
"imported": true
},
"folder": "Class Talents",
"formula": "2d6",
"links": [
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Class Talents: Barbarian": {
"flags": {
"imported": true,
"source": "Homebrew"
},
"folder": "Class Talents",
"formula": "2d6",
"links": [
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Class Talents: Delver": {
"flags": {
"imported": true
},
"folder": "Class Talents",
"formula": "2d6",
"links": [
{
"range": [
3,
6
],
"uuid": "Compendium.shadowdark.talents.Item.2IfYKGhWxyd3Ldr5"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
3,
6
],
"uuid": "Compendium.shadowdark.talents.Item.0yk16c9qcJ9vCekD"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.0yk16c9qcJ9vCekD"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.2IfYKGhWxyd3Ldr5"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Class Talents: Domain Priest": {
"flags": {
"imported": true
},
"folder": "Class Talents",
"formula": "2d6",
"links": [
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.excvhYcpm1qd09IV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.excvhYcpm1qd09IV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Class Talents: Duelist": {
"flags": {
"imported": true
},
"folder": "Class Talents",
"formula": "2d6",
"links": [
{
"range": [
3,
6
],
"uuid": "Compendium.shadowdark.talents.Item.0yk16c9qcJ9vCekD"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.UE2xABVKD0oCDtdx"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.0yk16c9qcJ9vCekD"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Class Talents: Eldritch Knight": {
"flags": {
"imported": true
},
"folder": "Class Talents",
"formula": "2d6",
"links": [
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.aRY0hjpvzYpdRbfR"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.aRY0hjpvzYpdRbfR"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Class Talents: Green Knight": {
"flags": {
"imported": true
},
"folder": "Class Talents",
"formula": "2d6",
"links": [
{
"range": [
3,
6
],
"uuid": "Compendium.shadowdark.talents.Item.0yk16c9qcJ9vCekD"
},
{
"range": [
3,
6
],
"uuid": "Compendium.shadowdark.talents.Item.2IfYKGhWxyd3Ldr5"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
7,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.excvhYcpm1qd09IV"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.0WmG5j0Wv685YTqO"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.0yk16c9qcJ9vCekD"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.2IfYKGhWxyd3Ldr5"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.excvhYcpm1qd09IV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.0WmG5j0Wv685YTqO"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Class Talents: Monk": {
"flags": {
"imported": true
},
"folder": "Class Talents",
"formula": "2d6",
"links": [
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.excvhYcpm1qd09IV"
}
]
},
"Core PDF p278: Treasure 7-9": {
"flags": {
"isLootTable": true,
"manifestId": "core-treasure-7-9",
"migratedToSuite": true,
"source": "core"
},
"folder": "CORE",
"formula": "1d100",
"links": [
{
"range": [
6,
7
],
"uuid": "Compendium.shadowdark.gear.Item.eqUuf9OGupuGPsBM"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.gear.Item.GUqtnSXkcytZnNiO"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.gear.Item.1T8oUkfkBtYTLNF3"
},
{
"range": [
20,
21
],
"uuid": "Compendium.shadowdark.gear.Item.GzA5T0aewhouRsa3"
},
{
"range": [
24,
25
],
"uuid": "Compendium.shadowdark.gear.Item.GUqtnSXkcytZnNiO"
},
{
"range": [
30,
31
],
"uuid": "Compendium.shadowdark.gear.Item.uS2iSw8NLx8V0jb7"
},
{
"range": [
28,
29
],
"uuid": "Compendium.shadowdark.gear.Item.zU6dopKBk3pKS9F9"
},
{
"range": [
38,
39
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
},
{
"range": [
48,
49
],
"uuid": "Compendium.shadowdark.gear.Item.lCWOUkVp4N1geMRt"
},
{
"range": [
74,
75
],
"uuid": "Compendium.shadowdark.magic-items.Item.jucTGEjsqJ1znHdf"
},
{
"range": [
76,
77
],
"uuid": "Compendium.shadowdark.magic-items.Item.YF9uaDDWLwFCYanF"
},
{
"range": [
82,
83
],
"uuid": "Compendium.shadowdark.magic-items.Item.lYl5E9urwAHXoqIr"
},
{
"range": [
86,
87
],
"uuid": "Compendium.shadowdark.magic-items.Item.RQyOkC3sGAe5gsn2"
}
]
},
"Core PDF p278: Unique Feature": {
"flags": {
"manifestId": "core-unique-feature",
"source": "core",
"tableType": "Treasure"
},
"folder": "CORE",
"formula": "1d20"
},
"Core PDF p279: Luxury Items": {
"flags": {
"manifestId": "core-luxury-items",
"source": "core",
"tableType": "Treasure"
},
"folder": "CORE",
"formula": "1d20",
"links": [
{
"range": [
11,
11
],
"uuid": "Compendium.shadowdark.gear.Item.GUqtnSXkcytZnNiO"
},
{
"range": [
14,
14
],
"uuid": "Compendium.shadowdark.gear.Item.bGrhQMkhE2qwjL4j"
},
{
"range": [
16,
16
],
"uuid": "Compendium.shadowdark.gear.Item.UWp4WkkiaBMSXYPE"
}
]
},
"Core PDF p280: Treasure 10+": {
"flags": {
"isLootTable": true,
"manifestId": "core-treasure-10",
"migratedToSuite": true,
"source": "core"
},
"folder": "CORE",
"formula": "1d100",
"links": [
{
"range": [
6,
7
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.gear.Item.eqUuf9OGupuGPsBM"
},
{
"range": [
14,
15
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
},
{
"range": [
22,
23
],
"uuid": "Compendium.shadowdark.gear.Item.C3mc5OlKPSJNMrng"
},
{
"range": [
26,
27
],
"uuid": "Compendium.shadowdark.gear.Item.o0261gnDqGC5hQB1"
},
{
"range": [
28,
29
],
"uuid": "Compendium.shadowdark.gear.Item.o0261gnDqGC5hQB1"
},
{
"range": [
34,
35
],
"uuid": "Compendium.shadowdark.gear.Item.9Pnhl6SOsbf6qDmt"
},
{
"range": [
40,
41
],
"uuid": "Compendium.shadowdark.gear.Item.9eTpsuEuzL3Vaxge"
},
{
"range": [
54,
55
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
},
{
"range": [
76,
77
],
"uuid": "Compendium.shadowdark.magic-items.Item.oS1VcB7hqcsjkUZv"
},
{
"range": [
82,
83
],
"uuid": "Compendium.shadowdark.magic-items.Item.XqUtkdpMMHiMhDF8"
},
{
"range": [
88,
89
],
"uuid": "Compendium.shadowdark.magic-items.Item.ZypO4jCOurSK2aOB"
},
{
"range": [
90,
91
],
"uuid": "Compendium.shadowdark.magic-items.Item.GIRNb0BTURa4wyLH"
},
{
"range": [
96,
97
],
"uuid": "Compendium.shadowdark.magic-items.Item.3Wgj18VMKb0KmRHI"
},
{
"range": [
98,
99
],
"uuid": "Compendium.shadowdark.magic-items.Item.fKKSAFFX6vVGEzSi"
},
{
"range": [
100,
100
],
"uuid": "Compendium.shadowdark.magic-items.Item.ck4lutlGUcVmIE6y"
}
]
},
"Core Rulebook - Carousing Event": {
"flags": {
"manifestId": "core-carousing-event",
"source": "core"
},
"folder": "CORE",
"formula": "1d7"
},
"Core Rulebook - Carousing Outcome": {
"flags": {
"manifestId": "core-carousing-outcome",
"source": "core"
},
"folder": "CORE",
"formula": "1d14"
},
"Cursed Scroll 2 p26: Enduring Wounds": {
"flags": {
"manifestId": "cs2-enduring-wounds",
"migratedToSuite": true,
"source": "cs2"
},
"folder": "CS2",
"formula": "1d20"
},
"Cursed Scroll 6 - Carousing Benefit": {
"flags": {
"manifestId": "cs6-benefit",
"source": "cs6"
},
"folder": "CS6",
"formula": "1d100"
},
"Cursed Scroll 6 - Carousing Event": {
"flags": {
"manifestId": "cs6-carousing-event",
"source": "cs6"
},
"folder": "CS6",
"formula": "1d10"
},
"Cursed Scroll 6 - Carousing Mishap": {
"flags": {
"manifestId": "cs6-mishap",
"source": "cs6"
},
"folder": "CS6",
"formula": "1d100"
},
"Cursed Scroll 6 - Carousing Outcome": {
"flags": {
"manifestId": "cs6-carousing-outcome",
"source": "cs6"
},
"folder": "CS6",
"formula": "1d25"
},
"Dwarf Names": {
"flags": {
"manifestId": "pgwr-dwarf-names",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Dwarf Trinket": {
"flags": {
"manifestId": "pgwr-dwarf-trinket",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Elf Names": {
"flags": {
"manifestId": "pgwr-elf-names",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Elf Trinket": {
"flags": {
"manifestId": "pgwr-elf-trinket",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Freya Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.UE2xABVKD0oCDtdx"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.excvhYcpm1qd09IV"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.0WmG5j0Wv685YTqO"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.0WmG5j0Wv685YTqO"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Gede Prayers": {
"folder": "Gods & Patrons",
"formula": "1d216"
},
"Goblin Names": {
"flags": {
"manifestId": "pgwr-goblin-names",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Goblin Trinket": {
"flags": {
"manifestId": "pgwr-goblin-trinket",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Half-Elf Names": {
"flags": {
"manifestId": "pgwr-half-elf-names",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Half-Elf Trinket": {
"flags": {
"manifestId": "pgwr-half-elf-trinket",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Half-Orc Names": {
"flags": {
"manifestId": "pgwr-half-orc-names",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Half-Orc Trinket": {
"flags": {
"manifestId": "pgwr-half-orc-trinket",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Halfling Names": {
"flags": {
"manifestId": "pgwr-halfling-names",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Halfling Trinket": {
"flags": {
"manifestId": "pgwr-halfling-trinket",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Human Names": {
"flags": {
"manifestId": "pgwr-human-names",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Human Trinket": {
"flags": {
"manifestId": "pgwr-human-trinket",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Kobold Names": {
"flags": {
"manifestId": "pgwr-kobold-names",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Kobold Trinket": {
"flags": {
"manifestId": "pgwr-kobold-trinket",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Krraktanamak Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.93QoQQ6cI7xa4TCm"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.93QoQQ6cI7xa4TCm"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Loki Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.UE2xABVKD0oCDtdx"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Madeera the Covenant Prayers": {
"folder": "Gods & Patrons",
"formula": "1d216"
},
"Memnon Prayers": {
"folder": "Gods & Patrons",
"formula": "1d216"
},
"Molek Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.aRY0hjpvzYpdRbfR"
},
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.93QoQQ6cI7xa4TCm"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.Ovw15rq5cAfDMe1t"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.93QoQQ6cI7xa4TCm"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.Ovw15rq5cAfDMe1t"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Mugdulblub Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
2,
2
],
"uuid": "Compendium.shadowdark.talents.Item.A9nJ9MYVegFPDwva"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.71NHQE8WsxOe9ShC"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.cOIRoHL3D9zGpOyX"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.Ovw15rq5cAfDMe1t"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.A9nJ9MYVegFPDwva"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.71NHQE8WsxOe9ShC"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.cOIRoHL3D9zGpOyX"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.Ovw15rq5cAfDMe1t"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Nord Backgrounds": {
"flags": {
"tableType": "background"
},
"folder": "Character Background",
"formula": "1d20"
},
"Oatali Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.Ovw15rq5cAfDMe1t"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.Ovw15rq5cAfDMe1t"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Obe-Ixx Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Odin Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.aRY0hjpvzYpdRbfR"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.S4zOvXqPlLLNmGKl"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.S4zOvXqPlLLNmGKl"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Ord Prayers": {
"folder": "Gods & Patrons",
"formula": "1d216"
},
"Oros Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Ramlaat Prayers": {
"folder": "Gods & Patrons",
"formula": "1d216"
},
"Random Encoutnter": {
"flags": {
"tableType": "other"
},
"folder": "Custom",
"formula": "1d10"
},
"Rathgamnon Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.aRY0hjpvzYpdRbfR"
},
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.UE2xABVKD0oCDtdx"
},
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.excvhYcpm1qd09IV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Saint Terragnis Prayers": {
"folder": "Gods & Patrons",
"formula": "1d216"
},
"Saint Ydris Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.ZfaFn8TDum3NXYZN"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.UE2xABVKD0oCDtdx"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.0WmG5j0Wv685YTqO"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.0WmG5j0Wv685YTqO"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Shune the Vile Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
2,
2
],
"uuid": "Compendium.shadowdark.talents.Item.IbWH7TwcOPMJt842"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.aRY0hjpvzYpdRbfR"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.UE2xABVKD0oCDtdx"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.9K2XPwkAA7BYZQrW"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.IbWH7TwcOPMJt842"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.9K2XPwkAA7BYZQrW"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Shune the Vile Prayers": {
"folder": "Gods & Patrons",
"formula": "1d216"
},
"TREASURE 0-3": {
"flags": {
"isLootTable": true,
"migratedToSuite": true,
"source": "",
"tableType": "loot"
},
"folder": "Custom",
"formula": "1d100",
"links": [
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.gear.Item.lCWOUkVp4N1geMRt"
},
{
"range": [
2,
3
],
"uuid": "Compendium.shadowdark.gear.Item.z3xc7HGysC4ZCU8e"
},
{
"range": [
12,
13
],
"uuid": "Compendium.shadowdark.gear.Item.C3mc5OlKPSJNMrng"
},
{
"range": [
18,
19
],
"uuid": "Compendium.shadowdark.gear.Item.GUqtnSXkcytZnNiO"
},
{
"range": [
28,
29
],
"uuid": "Compendium.shadowdark.gear.Item.EoTEHXApVDS7rHfw"
},
{
"range": [
30,
31
],
"uuid": "Compendium.shadowdark.gear.Item.UWp4WkkiaBMSXYPE"
},
{
"range": [
36,
37
],
"uuid": "Compendium.shadowdark.gear.Item.eqUuf9OGupuGPsBM"
},
{
"range": [
26,
27
],
"uuid": "Compendium.shadowdark.gear.Item.GzA5T0aewhouRsa3"
},
{
"range": [
38,
39
],
"uuid": "Compendium.shadowdark.gear.Item.KQTWQwznjK80gVEU"
},
{
"range": [
32,
33
],
"uuid": "Compendium.shadowdark.gear.Item.1T8oUkfkBtYTLNF3"
},
{
"range": [
20,
21
],
"uuid": "Compendium.shadowdark.gear.Item.9Pnhl6SOsbf6qDmt"
},
{
"range": [
54,
55
],
"uuid": "Compendium.shadowdark.gear.Item.UWp4WkkiaBMSXYPE"
},
{
"range": [
56,
57
],
"uuid": "Compendium.shadowdark.gear.Item.C3mc5OlKPSJNMrng"
},
{
"range": [
66,
67
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
},
{
"range": [
68,
69
],
"uuid": "Compendium.shadowdark.gear.Item.z98LNu4yOIe1B1eg"
},
{
"range": [
78,
79
],
"uuid": "Compendium.shadowdark.gear.Item.UWp4WkkiaBMSXYPE"
},
{
"range": [
82,
83
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
},
{
"range": [
90,
91
],
"uuid": "Compendium.shadowdark.magic-items.Item.KAx02m6uAzOSBGXX"
},
{
"range": [
94,
95
],
"uuid": "Compendium.shadowdark.magic-items.Item.LflQgWEekkaKPm8Z"
},
{
"range": [
98,
99
],
"uuid": "Compendium.shadowdark.magic-items.Item.vHwzxeO0sX9GlRbj"
},
{
"range": [
101,
102
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
}
]
},
"TREASURE 4-6": {
"flags": {
"isLootTable": true,
"migratedToSuite": true,
"source": "",
"tableType": "loot"
},
"folder": "Custom",
"formula": "1d100",
"links": [
{
"range": [
6,
7
],
"uuid": "Compendium.shadowdark.gear.Item.UWp4WkkiaBMSXYPE"
},
{
"range": [
12,
13
],
"uuid": "Compendium.shadowdark.gear.Item.eqUuf9OGupuGPsBM"
},
{
"range": [
14,
15
],
"uuid": "Compendium.shadowdark.gear.Item.B3ZPeUtbChN8lrDm"
},
{
"range": [
22,
23
],
"uuid": "Compendium.shadowdark.gear.Item.W2fFimb0y85wmOMb"
},
{
"range": [
26,
27
],
"uuid": "Compendium.shadowdark.gear.Item.bGrhQMkhE2qwjL4j"
},
{
"range": [
32,
33
],
"uuid": "Compendium.shadowdark.gear.Item.z98LNu4yOIe1B1eg"
},
{
"range": [
40,
41
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
},
{
"range": [
42,
43
],
"uuid": "Compendium.shadowdark.gear.Item.uS2iSw8NLx8V0jb7"
},
{
"range": [
56,
57
],
"uuid": "Compendium.shadowdark.gear.Item.uS2iSw8NLx8V0jb7"
},
{
"range": [
60,
61
],
"uuid": "Compendium.shadowdark.gear.Item.DeqtKQQzI6HTYvV0"
},
{
"range": [
62,
63
],
"uuid": "Compendium.shadowdark.gear.Item.eeVEJexfirwWzOVu"
},
{
"range": [
64,
65
],
"uuid": "Compendium.shadowdark.gear.Item.o0261gnDqGC5hQB1"
},
{
"range": [
68,
69
],
"uuid": "Compendium.shadowdark.gear.Item.GUqtnSXkcytZnNiO"
},
{
"range": [
50,
53
],
"uuid": "Compendium.shadowdark.gear.Item.ZPUhNMmwXXrtbCXi"
},
{
"range": [
76,
77
],
"uuid": "Compendium.shadowdark.gear.Item.UWp4WkkiaBMSXYPE"
},
{
"range": [
80,
81
],
"uuid": "Compendium.shadowdark.gear.Item.o0261gnDqGC5hQB1"
},
{
"range": [
84,
85
],
"uuid": "Compendium.shadowdark.magic-items.Item.jucTGEjsqJ1znHdf"
},
{
"range": [
90,
91
],
"uuid": "Compendium.shadowdark.magic-items.Item.Ap6sRdj5Jd54oUrq"
},
{
"range": [
94,
95
],
"uuid": "Compendium.shadowdark.magic-items.Item.dGfhC5esJRavsNGW"
},
{
"range": [
98,
99
],
"uuid": "Compendium.shadowdark.magic-items.Item.0c0G5Dnzq9Il8zZY"
},
{
"range": [
88,
89
],
"uuid": "Compendium.shadowdark.magic-items.Item.yyJOvnqhX1euicdL"
}
]
},
"The Lost Prayers": {
"folder": "Gods & Patrons",
"formula": "1d216"
},
"The Willowman Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
2,
2
],
"uuid": "Compendium.shadowdark.talents.Item.EUE1pFpmreF9ZMKx"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.H6gRb0879zMVYdiO"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.EUE1pFpmreF9ZMKx"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.H6gRb0879zMVYdiO"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Titania Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
2,
2
],
"uuid": "Compendium.shadowdark.talents.Item.rtCyEISzbgf6ZuJb"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
8,
9
],
"uuid": "Compendium.shadowdark.talents.Item.UE2xABVKD0oCDtdx"
},
{
"range": [
10,
11
],
"uuid": "Compendium.shadowdark.talents.Item.52dWOJ8zzxCwfM1B"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.rtCyEISzbgf6ZuJb"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.talents.Item.52dWOJ8zzxCwfM1B"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
},
"Western Reach Backgrounds": {
"flags": {
"imported": true,
"source": "Western Reaches"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Western Reaches - Backgrounds": {
"flags": {
"imported": true
},
"folder": "Character Background",
"formula": "1d100"
},
"Western Reaches - Carousing Benefit": {
"flags": {
"manifestId": "pgwr-carousing-benefit",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Western Reaches - Carousing Event": {
"flags": {
"manifestId": "pgwr-carousing-event",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d10"
},
"Western Reaches - Carousing Mishap": {
"flags": {
"manifestId": "pgwr-carousing-mishap",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d100"
},
"Western Reaches - Carousing Outcome": {
"flags": {
"manifestId": "pgwr-carousing-outcome",
"source": "pgwr"
},
"folder": "Western Reaches",
"formula": "1d25"
},
"Western Reaches - Dwarf Names": {
"flags": {
"tableType": "character-names"
},
"folder": "Names",
"formula": "1d100"
},
"Western Reaches - Elf Names": {
"flags": {
"tableType": "character-names"
},
"folder": "Names",
"formula": "1d100"
},
"Western Reaches - Half-Elf Names": {
"flags": {
"tableType": "character-names"
},
"folder": "Names",
"formula": "1d100"
},
"Yag-Kesh Boons": {
"folder": "Gods & Patrons",
"formula": "2d6",
"links": [
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.6t06nSjj1hd6o5SV"
},
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.vIbwotCa1eqCVZMU"
},
{
"range": [
3,
7
],
"uuid": "Compendium.shadowdark.talents.Item.excvhYcpm1qd09IV"
},
{
"range": [
12,
12
],
"uuid": "Compendium.shadowdark.rollable-tables.RollTable.EmBGQUSaf5L7ojKJ"
}
]
}
};
