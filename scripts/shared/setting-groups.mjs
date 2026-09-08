/**
 * Feature groups for Configure Settings.
 *
 * Each group is one GM-only pop-out button under Shadowdark Enhancer
 * (registered by settings-group-menu.mjs). A section's `entries` are either a
 * setting key — registered elsewhere with `config: false`, so it leaves the
 * main list — or `{ menu, icon }` for a nested editor window. Order here is
 * display order; a section with a `label` renders as a titled fieldset.
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
      { entries: ["spellMishapAutoRoll", "luckRerollPreventNat1"] },
      { label: "SDE.settings.pcAutomationMenu.duelist", entries: ["tauntAutomate", "parryAutomate"] },
      { label: "SDE.settings.pcAutomationMenu.delver", entries: ["scavengerAutomate", "scavengerWatchAmmo"] },
      { label: "SDE.settings.pcAutomationMenu.renown", entries: ["renownOnCreate", "renownOnLevelUp"] },
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

/** Every setting key that renders inside a group pop-out. */
export const GROUPED_SETTING_KEYS = SETTING_GROUPS.flatMap((g) =>
  g.sections.flatMap((s) => s.entries.filter((e) => typeof e === "string")),
);

/** Every nested menu key that renders inside a group pop-out. */
export const GROUPED_MENU_KEYS = SETTING_GROUPS.flatMap((g) =>
  g.sections.flatMap((s) => s.entries.filter((e) => typeof e !== "string").map((e) => e.menu)),
);
