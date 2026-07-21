# Art Credits

## Character Builder — ancestry portraits (`assets/ancestries/`)

Black-and-white ancestry portraits (Dwarf, Elf, Goblin, Half-Orc, Kobold; Elf
reused for Half-Elf) are by **Mariana Ruiz Villarreal (LadyofHats)**, released
into the **public domain (CC0)**. No attribution is required for CC0 works; it
is provided here as a courtesy. Images were resized/re-encoded to WebP for the
module.

- `human.png` — "Robin Hood" by **Louis Rhead**, from *Bold Robin Hood and His
  Outlaw Band* (New York, 1912). **Public domain** (Rhead d. 1926; pre-1929
  publication). Cropped (banner/frame removed) and cleaned to black-on-white.

## UI button icons (`icons/game-icons/`)

The following icons are from [game-icons.net](https://game-icons.net/) and are
licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The
SVGs are rendered as monochrome images with a CSS color filter; their artwork
is otherwise unchanged.

- `flame.svg` — **Carl Olsen**
- `perspective-dice-six-faces-random.svg` — **Delapouite**
- `skull-crossed-bones.svg`, `crossed-swords.svg`, `open-book.svg`,
  `visored-helm.svg`, `dragon-head.svg` — **Lorc**
- `open-treasure-chest.svg` — **Skoll**

## Class icons (`icons/game-icons/classes/`)

One icon per class, chosen to match each class's description. Also from
[game-icons.net](https://game-icons.net/) under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); the SVGs are
recolored gold (`fill` attribute changed from `#000` to `#c9a54a`) and the
artwork is otherwise unchanged.

- `holy-symbol.svg` (Priest), `hood.svg` (Thief), `pointy-hat.svg` (Wizard),
  `lyre.svg` (Bard), `snake-totem.svg` (Basilisk Warrior),
  `stag-head.svg` (Green Knight), `winged-sword.svg` (Paladin),
  `shadow-follower.svg` (Ras-Godai), `horned-helm.svg` (Sea Wolf),
  `crystal-ball.svg` (Seer), `cauldron.svg` (Witch),
  `tentacle-heart.svg` (Wyrdling), `arrow-cluster.svg` (Kyzian Archer),
  `whip.svg` (Explorer) — **Lorc**
- `sword-brandish.svg` (Fighter), `light-backpack.svg` (Delver),
  `cavalry.svg` (Desert Rider), `fencer.svg` (Duelist),
  `devil-mask.svg` (Knight of St. Ydris), `high-punch.svg` (Monk of Yag-Kesh),
  `spartan-helmet.svg` (Pit Fighter), `archer.svg` (Ranger) — **Delapouite**
- `raise-zombie.svg` (Necromancer), `pentacle.svg` (Warlock) — **Skoll**
- `clover.svg` (Roustabout) — **Sbed**

## Item icons (`assets/icons/shikashi/`)

284 item icons from **Shikashi's Fantasy Icons Pack v2** by **Shikashi**
(v2, 19 April 2020). The pack's readme permits use and remix in commercial
games and projects. Many of the pack's designs are based on **game-icons.net**
icons, which are **CC BY 3.0**. Individual 32×32 icons were sliced from the
pack's transparent spritesheet, upscaled 4× (nearest neighbor), and encoded
as lossless WebP for the module.

## Bundled code (`scripts/pdf-export/lib/`)

- `pdf-lib.esm.min.js` — [**pdf-lib**](https://github.com/Hopding/pdf-lib)
  **v1.17.1** (ESM build) by **Andrew Dillon**, **MIT licensed** (© 2019 Andrew
  Dillon). Used browser-side to fill the AcroForm character-sheet template on
  "Export to PDF". Vendored unmodified except for stripping the trailing
  `sourceMappingURL` comment (the map is not shipped). The full upstream license
  text ships beside the bundle in
  [`scripts/pdf-export/lib/LICENSE`](scripts/pdf-export/lib/LICENSE).
