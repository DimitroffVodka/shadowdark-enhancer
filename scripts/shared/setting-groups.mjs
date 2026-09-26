/**
 * Feature groups for Configure Settings.
 *
 * Each group is one GM-only pop-out button under Shadowdark Enhancer
 * (registered by settings-group-menu.mjs). A section's `entries` are:
 *   - a setting key of this module, registered elsewhere with `config: false`
 *     so it leaves the main list; or `{ key, pending: true }` for one whose
 *     automation is not built yet, which renders with a note saying so; or
 *     `{ key, option: true }` for a mode's option that is not one of its
 *     rules (Chaos's Dice So Nice), which the mode's switch leaves alone;
 *   - `{ menu, icon }` for a nested editor window;
 *   - `{ setting: "namespace.key", missing, showIf }` for ANOTHER package's
 *     setting, rendered in place so it keeps one source of truth (the
 *     system's Pulp and Momentum switches, Extras' Grinder); `missing` is the
 *     note shown when that package or setting is absent, and `showIf` names a
 *     checkbox in the same window the row only shows while ticked;
 *   - `{ note }` for a rule nothing can automate: a line of text.
 * Order here is display order. A section with a `label` renders as a titled
 * block: collapsible by default, or an always-open fieldset with `mode: true`,
 * which also gets a switch that sets or clears every rule checkbox in it.
 *
 * Pure data, no Foundry globals: test/docs-contract.test.mjs imports it under
 * node so grouped settings stay held to the same docs and i18n contract as
 * the ones still visible in the main list.
 */
export const SETTING_GROUPS = [
  {
    key: "charBuilderMenu",
    icon: "fa-solid fa-user-plus",
    sections: [{
      entries: [
        "charBuilderStatMethod",
        "charBuilderLockStatRolls",
        "charBuilderLockTalentRolls",
        "charBuilderLockGoldRolls",
        "charBuilderLockHpRolls",
        "charBuilderArtFolder",
        "charBuilderDiceSoNice",
        "charBuilderMaxLevel1HP",
        "charBuilderStartingGold",
        { menu: "charBuilderExtraGear", icon: "fa-solid fa-toolbox" },
      ],
    }],
  },
  {
    key: "monstersMenu",
    icon: "fa-solid fa-dragon",
    sections: [{
      entries: [
        { menu: "monsterSpellLibrary", icon: "fa-solid fa-book-sparkles" },
        { menu: "levelGuidelines", icon: "fa-solid fa-scale-balanced" },
      ],
    }],
  },
  {
    key: "pcAutomationMenu",
    icon: "fa-solid fa-wand-magic-sparkles",
    sections: [
      { entries: ["spellMishapAutoRoll"] },
      { label: "SDE.settings.pcAutomationMenu.duelist", entries: ["tauntAutomate", "parryAutomate"] },
      { label: "SDE.settings.pcAutomationMenu.delver", entries: ["scavengerAutomate", "scavengerWatchAmmo"] },
      { label: "SDE.settings.pcAutomationMenu.renown", entries: ["renownOnCreate", "renownOnLevelUp"] },
    ],
  },
  {
    // Core rulebook p.111 and GMWR p.30. Every rule is its own setting so any
    // one can run without the rest of its mode; a mode's switch is a UI
    // convenience over its checkboxes, never a setting of its own.
    key: "modesOfPlayMenu",
    icon: "fa-solid fa-dice",
    sections: [
      { label: "SDE.settings.modesOfPlayMenu.blitz", hint: "SDE.settings.modesOfPlayMenu.blitzHint", mode: true,
        entries: ["modeBlitzLights"] },
      { label: "SDE.settings.modesOfPlayMenu.chaos", hint: "SDE.settings.modesOfPlayMenu.chaosHint", mode: true,
        entries: ["modeChaosInitiative", { key: "modeChaosDiceSoNice", option: true }] },
      { label: "SDE.settings.modesOfPlayMenu.deadly", hint: "SDE.settings.modesOfPlayMenu.deadlyHint", mode: true,
        entries: [{ key: "modeDeadlyTimer", pending: true }, { key: "modeDeadlyStabilize", pending: true }] },
      { label: "SDE.settings.modesOfPlayMenu.fatality", hint: "SDE.settings.modesOfPlayMenu.fatalityHint", mode: true,
        entries: [{ key: "modeFatality", pending: true }] },
      { label: "SDE.settings.modesOfPlayMenu.grinder", hint: "SDE.settings.modesOfPlayMenu.grinderHint", mode: true,
        entries: [
          // The keys are the contract with Extras (DimitroffVodka/shadowdark-extras#149).
          { setting: "shadowdark-extras.grinderMode", missing: "SDE.settings.modesOfPlayMenu.grinderNeedsExtras" },
          { setting: "shadowdark-extras.grinderHitDice", showIf: "shadowdark-extras.grinderMode" },
        ] },
      { label: "SDE.settings.modesOfPlayMenu.hunter", hint: "SDE.settings.modesOfPlayMenu.hunterHint", mode: true,
        entries: ["modeHunterXp"] },
      { label: "SDE.settings.modesOfPlayMenu.momentum", hint: "SDE.settings.modesOfPlayMenu.momentumHint", mode: true,
        entries: [
          { setting: "shadowdark.useMomentumMode", missing: "SDE.settings.modesOfPlayMenu.systemMissing" },
          { note: "SDE.settings.modesOfPlayMenu.momentumRepeat" },
        ] },
      { label: "SDE.settings.modesOfPlayMenu.pulp", hint: "SDE.settings.modesOfPlayMenu.pulpHint", mode: true,
        entries: [
          { setting: "shadowdark.usePulpMode", missing: "SDE.settings.modesOfPlayMenu.systemMissing" },
          { key: "modePulpSessionLuck", pending: true },
          { key: "modePulpLuckCrit", pending: true },
          { key: "modePulpForceReroll", pending: true },
          { note: "SDE.settings.modesOfPlayMenu.pulpExtraAction" },
        ] },
      { label: "SDE.settings.modesOfPlayMenu.hardLuck", hint: "SDE.settings.modesOfPlayMenu.hardLuckHint", mode: true,
        entries: ["luckRerollPreventNat1", "modeHardLuckEffects"] },
    ],
  },
  {
    key: "movementMenu",
    icon: "fa-solid fa-person-running",
    sections: [{
      entries: [
        "combatMovementDefault",
        "oocMovementBudget",
        "oocEnforceBudget",
        "combatEnforceBudget",
        "lockMovementOutOfTurn",
      ],
    }],
  },
  {
    key: "crawlStripMenu",
    icon: "fa-solid fa-table-columns",
    sections: [{ entries: ["gmAvatarImage", "warnIfCrawlHelperEnabled"] }],
  },
  {
    key: "encountersMenu",
    icon: "fa-solid fa-dice-d20",
    sections: [{ entries: ["encounterRollGMOnly", "pauseOnEncounter", "autoRollActiveTable"] }],
  },
  {
    key: "lootXpMenu",
    icon: "fa-solid fa-coins",
    sections: [{
      entries: [
        "lootDropEnabled",
        "lootDropMode",
        "lootDropChance",
        { menu: "monsterLoot", icon: "fa-solid fa-skull" },
        "itemDropsEnabled",
        "xpThresholdNormal",
        "xpThresholdFabulous",
        "uniqueFeatureChance",
      ],
    }],
  },
];

/** This module's setting key for an entry, or null (a menu, a note, another package's setting). */
export const entryKey = (e) => (typeof e === "string" ? e : (e?.key ?? null));

/** Every setting key of this module that renders inside a group pop-out. */
export const GROUPED_SETTING_KEYS = SETTING_GROUPS.flatMap((g) =>
  g.sections.flatMap((s) => s.entries.map(entryKey).filter(Boolean)),
);

/** Every nested menu key that renders inside a group pop-out. */
export const GROUPED_MENU_KEYS = SETTING_GROUPS.flatMap((g) =>
  g.sections.flatMap((s) => s.entries.filter((e) => e?.menu).map((e) => e.menu)),
);

/** Every i18n key a group renders besides its settings' own name and hint. */
export const GROUP_STRING_KEYS = SETTING_GROUPS.flatMap((g) => [
  `SDE.settings.${g.key}.name`, `SDE.settings.${g.key}.hint`, `SDE.settings.${g.key}.label`,
  ...g.sections.flatMap((s) => [
    s.label, s.hint, ...(s.mode && s.label ? [`${s.label}Switch`] : []),
    ...s.entries.flatMap((e) => [e?.note, e?.missing]),
  ]),
]).filter(Boolean);

/**
 * A mode switch's state from its rules' checkbox values: "on" only when every
 * rule is on, "off" when none is, else "mixed". A mode with no checkbox (its
 * rules all belong to a package that is not installed) is "off".
 * @param {boolean[]} values
 * @returns {"on"|"off"|"mixed"}
 */
export function modeSwitchState(values) {
  const on = values.filter(Boolean).length;
  if (!values.length || on === 0) return "off";
  return on === values.length ? "on" : "mixed";
}
