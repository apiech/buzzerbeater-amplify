import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "cdk.out/**",
      "node_modules/**",
      "node_modules.bak.*/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
