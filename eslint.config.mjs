import js from "@eslint/js";
import globals from "globals";

/**
 * Flat ESLint config for the module scripts (browser + Foundry globals) and
 * the node-based test suite. Deliberately lenient: this codebase predates the
 * linter, so the goal is to catch real errors (undefined vars, unreachable
 * code) without a mass reformat.
 */
export default [
  {
    ignores: ["node_modules/**", "assets/**", "templates/**", "styles/**"],
  },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Foundry VTT + Shadowdark system globals available at runtime.
        game: "readonly",
        ui: "readonly",
        canvas: "readonly",
        Hooks: "readonly",
        CONFIG: "readonly",
        CONST: "readonly",
        foundry: "readonly",
        Actor: "readonly",
        Item: "readonly",
        ChatMessage: "readonly",
        RollTable: "readonly",
        Roll: "readonly",
        Dialog: "readonly",
        Handlebars: "readonly",
        Folder: "readonly",
        Scene: "readonly",
        JournalEntry: "readonly",
        Combat: "readonly",
        TokenDocument: "readonly",
        CompendiumCollection: "readonly",
        Macro: "readonly",
        fromUuid: "readonly",
        fromUuidSync: "readonly",
        renderTemplate: "readonly",
        shadowdark: "readonly",
        jQuery: "readonly",
        $: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-console": "off",
      // Both fire on intentional patterns in the PDF statblock parser and
      // various regexes; keep them visible without failing the build.
      "no-useless-escape": "warn",
      "no-control-regex": "warn",
    },
  },
  {
    files: ["test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
