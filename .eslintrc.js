module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  env: {
    node: true,
    es6: true,
    "jest/globals": true,
  },
  plugins: ["@typescript-eslint", "jest"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:jest/recommended",
    "plugin:prettier/recommended",
  ],
  rules: {
    "jest/expect-expect": ["off"],
    "@typescript-eslint/no-namespace": ["off"],

    // Rules to disable in V5 port
    "@typescript-eslint/no-var-requires": ["off"],
  },
};
