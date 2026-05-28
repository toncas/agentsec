// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(...tseslint.configs.recommended, {
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "warn",
  },
  languageOptions: {
    parserOptions: {
      project: "./tsconfig.json",
    },
  },
  ignores: ["dist/**", "node_modules/**"],
});
