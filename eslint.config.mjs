import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Controlled inputs sync props → local draft state; valid for inline editors.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "topology/**",
    "executive-presentation/**",
    "middleware/**",
    "node_modules/**",
    "extract-baseline.js",
    "scripts/extract-*.js",
    "Integration Merge/**",
    "Website Audit/**",
    "Mia's needds/**",
    "20250107/**",
  ]),
]);

export default eslintConfig;