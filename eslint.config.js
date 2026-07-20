const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  // Provided verbatim modules (frontend + backend logic) are excluded from lint.
  {
    ignores: [
      "node_modules",
      "data",
      "public/app.js",
      "lib/ato-standards.js",
      "lib/tax-calculator.js",
      "lib/forecast.js",
      "lib/storage.js",
      "lib/receipt-ocr.js",
      "lib/receipt-ocr-money.js",
      "lib/local-receipt-ocr.js",
      "lib/income-document-ocr.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
];
