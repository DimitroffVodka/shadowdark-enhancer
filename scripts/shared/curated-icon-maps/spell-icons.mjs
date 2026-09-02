/**
 * Reviewed Foundry-native icons for the imported Shadowdark spells.
 *
 * Every spell the importer creates used to land on one generic casting-hand
 * image: in a freshly imported world 77 of 107 spells wore the same icon, which
 * is no icon at all — a spell list you cannot read at a glance. These rows were
 * chosen per spell from its DESCRIPTION rather than its name, because the names
 * routinely do not describe the effect (First / Second / Third Gate are sleep,
 * silence and mind-reading respectively).
 *
 * DEFINED, not registered. Every other map publishes itself into the shared
 * bare registry at import time; this one must not, because "a spell never
 * takes an item map's icon" is an invariant that space cannot express — a
 * spell named `Web` would inherit the weapon map's blade. item-importer
 * builds a spell-only registry from it instead. Verified against the installed
 * icon tree in test/spell-icons.test.mjs.
 *
 * Five rows are documented compromises where core Foundry has no matching
 * asset at all: Befriend (no mouse or moth exists), Magnetize (no magnet),
 * Oxidize (no rust), Second Gate (no silence), Balance (no petrification).
 */
import { CURATED_KEY_SPACES, defineCuratedIconMap } from "../curated-icons.mjs";

export const SPELL_ICONS = defineCuratedIconMap("spells", {
  "Abjure": "icons/magic/death/bones-crossed-gray.webp",
  "Absorb": "icons/magic/defensive/barrier-shield-dome-deflect-blue.webp",
  "Alchemy": "icons/magic/symbols/elements-air-earth-fire-water.webp",
  "Anchor": "icons/commodities/cloth/thread-spindle-black.webp",
  "Anima": "icons/magic/earth/construct-stone-long-arms.webp",
  "Animate Dead": "icons/magic/death/hand-dirt-undead-zombie.webp",
  "Ashes to Ashes": "icons/magic/death/skull-sand-white-yellow.webp",
  "Balance": "icons/magic/defensive/armor-stone-skin.webp",
  "Banish": "icons/magic/movement/portal-vortex-orange.webp",
  "Barkskin": "icons/magic/nature/hand-weapon-wood-bark-brown.webp",
  "Bear Shape": "icons/creatures/abilities/bear-roar-bite-brown.webp",
  "Befriend": "icons/creatures/invertebrates/beetle-stag-tan-brown.webp",
  "Betrayal": "icons/skills/melee/strike-dagger-blood-red.webp",
  "Blight": "icons/magic/nature/tree-spirit-black.webp",
  "Breath": "icons/magic/water/bubbles-air-water-blue.webp",
  "Cleanse": "icons/magic/nature/leaf-drip-light-green.webp",
  "Consecrate": "icons/magic/holy/barrier-shield-winged-cross.webp",
  "Contagion": "icons/commodities/biological/pustules-brown.webp",
  "Covenant": "icons/magic/holy/angel-winged-humanoid-blue.webp",
  "Create Undead": "icons/magic/death/undead-skeleton-rags-fire-green.webp",
  "Damnation": "icons/magic/unholy/silhouette-evil-horned-giant.webp",
  "Defile": "icons/magic/symbols/rune-sigil-black-pink.webp",
  "Dismember": "icons/skills/wounds/bone-broken-marrow-red.webp",
  "Dispel Magic": "icons/magic/symbols/rune-sigil-rough-white-teal.webp",
  "Drain Life": "icons/magic/unholy/strike-beam-blood-large-red-purple.webp",
  "Dust to Dust": "icons/magic/death/grave-tombstone-glow-tan.webp",
  "Excoriate": "icons/magic/unholy/strike-body-life-soul-green.webp",
  "Extract": "icons/magic/control/hypnosis-mesmerism-eye-tan.webp",
  "Eyebite": "icons/magic/perception/eye-ringed-glow-angry-red.webp",
  "Feast": "icons/magic/nature/cornucopia-orange.webp",
  "Fifth Gate": "icons/magic/life/ankh-shadow-green.webp",
  "Final Toll": "icons/tools/instruments/bell-brass.webp",
  "First Gate": "icons/magic/control/sleep-bubble-purple.webp",
  "Flare": "icons/magic/light/projectile-flare-expliosion-yellow.webp",
  "Forbid": "icons/magic/symbols/rune-sigil-red-orange.webp",
  "Fortify": "icons/magic/defensive/armor-shield-barrier-steel.webp",
  "Fourth Gate": "icons/magic/death/undead-skeleton-worn-blue.webp",
  "Ghoul Touch": "icons/magic/unholy/hand-claw-fog-green.webp",
  "Halo": "icons/magic/holy/saint-glass-portrait-halo.webp",
  "Harm": "icons/magic/death/hand-withered-gray.webp",
  "Identify": "icons/sundries/books/book-backed-blue-gold.webp",
  "Instill": "icons/magic/symbols/runes-etched-steel-blade.webp",
  "Lamentation": "icons/magic/sonic/scream-wail-shout-teal.webp",
  "Lay to Rest": "icons/magic/holy/angel-wings-gray.webp",
  "Locusts": "icons/creatures/invertebrates/wasp-swarm-attack.webp",
  "Magnetize": "icons/commodities/metal/fragments-steel-ring.webp",
  "Meld": "icons/magic/control/silhouette-aura-energy.webp",
  "Mesmerism": "icons/magic/control/hypnosis-mesmerism-swirl.webp",
  "Mischief": "icons/magic/control/mouth-smile-deception-purple.webp",
  "Mycelium": "icons/magic/nature/mushrooms-fire-glow-blue.webp",
  "Naming": "icons/magic/symbols/runes-carved-stone-yellow.webp",
  "Oxidize": "icons/commodities/metal/barstock-broken-steel.webp",
  "Pacify": "icons/skills/social/diplomacy-peace-alliance.webp",
  "Peace": "icons/creatures/birds/dove-pigeon-flying-white.webp",
  "Permanence": "icons/magic/symbols/circle-ouroboros.webp",
  "Phantoms": "icons/magic/death/undead-ghost-scream-teal.webp",
  "Prayer": "icons/magic/holy/prayer-hands-glowing-yellow.webp",
  "Push/Pull": "icons/magic/air/air-burst-spiral-large-blue.webp",
  "Rapture": "icons/magic/light/beam-horizon-strike-yellow.webp",
  "Reap the Soul": "icons/magic/death/weapon-scythe-rune-green.webp",
  "Revenant": "icons/magic/death/undead-skeleton-energy-green.webp",
  "Revitalize": "icons/magic/life/cross-area-circle-green-white.webp",
  "Riverwalk": "icons/magic/water/vortex-water-whirlpool-blue.webp",
  "Second Gate": "icons/commodities/biological/tongue-violet.webp",
  "Serpent": "icons/creatures/reptiles/snake-fangs-bite-green.webp",
  "Siphon": "icons/magic/unholy/orb-colllecting-energy-green.webp",
  "Stasis": "icons/magic/time/clock-stopwatch-white-blue.webp",
  "Subjugate": "icons/magic/control/control-influence-puppet.webp",
  "Summon Soul": "icons/magic/death/undead-ghost-strike-white.webp",
  "Third Gate": "icons/commodities/biological/organ-brain-pink-purple.webp",
  "Treeshape": "icons/magic/nature/tree-animated-strike.webp",
  "Truespeech": "icons/creatures/birds/corvid-call-sound-glowing.webp",
  "Turn Undead": "icons/magic/symbols/cross-circle-blue.webp",
  "Unhinge": "icons/magic/control/fear-fright-mask-orange.webp",
  "Unlife": "icons/magic/death/skeleton-eye-skull-glow-orange.webp",
  "Vision": "icons/magic/perception/eye-ringed-glow-angry-large-teal.webp",
  "Wrack": "icons/skills/wounds/injury-body-pain-gray.webp",
}, { space: CURATED_KEY_SPACES.BARE });
