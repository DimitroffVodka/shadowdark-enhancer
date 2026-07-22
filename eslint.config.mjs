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
    // Vendored, minified third-party runtime (pdf-lib v1.17.1, MIT — see
    // scripts/pdf-export/lib/LICENSE). Not our source; linting a 512 KB minified
    // bundle only produces noise. Scoped to the vendor dir, not a rule weakening.
    ignores: ["node_modules/**", "assets/**", "templates/**", "styles/**", "scripts/pdf-export/lib/**"],
  },
  js.configs.recommended,
  {
    // test/quench/ runs INSIDE the Foundry client (Quench batches), so it
    // shares the browser + Foundry globals, not the node test block below.
    files: ["scripts/**/*.mjs", "test/quench/**/*.mjs"],
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
        FilePicker: "readonly",
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
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
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
