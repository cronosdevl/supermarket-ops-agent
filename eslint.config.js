// ESLint flat config (v9). typescript-eslint for correctness, Prettier owns
// formatting (eslint-config-prettier turns off any stylistic rules that would
// fight it). Run `npm run lint`; `npm run format` handles layout.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "artifacts/**", "data/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Allow deliberately-unused args/vars when prefixed with "_".
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // A few third-party surfaces (pdfmake, pptxgenjs) are typed loosely and
      // need `any` at the boundary; don't fail the build over it.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettier,
);
