// @ts-check
import tsParser from "@typescript-eslint/parser";
import fs from "node:fs";
import path from "node:path";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import graphileExport from "eslint-plugin-graphile-export";
import jest from "eslint-plugin-jest";
import globals from "globals";
import tseslint from "typescript-eslint";

const __dirname = import.meta.dirname;

const globalIgnoresFromFile = fs
  .readFileSync(path.resolve(__dirname, ".lintignore"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    let text = line;
    text = text.startsWith("/") ? text.substring(1) : `**/${text}`;
    text = text.endsWith("/") ? text + "**" : text;
    return text;
  });

/** @type {import('@eslint/config-helpers').ConfigWithExtends} */
const config = {
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 9,
    sourceType: "module",
    globals: {
      ...globals.node,
      ...globals.jest,
    },
  },

  plugins: {
    jest,
  },

  rules: {
    "jest/expect-expect": ["off"],
    "@typescript-eslint/no-namespace": ["off"],
    "@typescript-eslint/no-explicit-any": ["off"],
  },
};

export default defineConfig([
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier, // not a plugin, just a config object
  graphileExport.configs.recommended,
  jest.configs["flat/recommended"],
  config,

  // overrides
  {
    files: ["__tests__/**/*.js"],
    rules: {
      // Rules to disable in V5 port
      "@typescript-eslint/no-require-imports": ["off"],
    },
  },

  globalIgnores(globalIgnoresFromFile),
]);
