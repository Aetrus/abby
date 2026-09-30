import type { AbbyDataResponse } from "@tryabby/core";
import { boolean } from "@tryabby/core/validation";
import { createAbby, defineConfig } from "@tryabby/vue";

// A fresh, demo-only cookie namespace makes each page load reproducible.
// It is not an account or a real Abby project identifier.
const projectId = `vue-offline-demo-${Date.now()}`;

export const abby = createAbby(
  defineConfig(
    {
      projectId,
      currentEnvironment: "development",
      apiUrl: "https://offline-demo.invalid/",
    },
    {
      environments: ["development"],
      tests: { checkout: { variants: ["control", "treatment"] } },
      flags: ["betaDashboard", "showBanner"],
      remoteConfig: { welcomeText: "String", buttonSuffix: "String" },
      user: { isBeta: boolean() },
      cookies: { disableByDefault: true },
      // initialData below prevents loading. Fail closed if a load is added later.
      fetch: async () => {
        throw new Error("This offline demo does not fetch Abby project data");
      },
    }
  )
);

export const initialData: AbbyDataResponse = {
  // One non-zero weight also keeps the initial assignment deterministic after consent.
  tests: [{ name: "checkout", weights: [1, 0] }],
  flags: [
    {
      name: "betaDashboard",
      value: false,
      ruleSet: [
        {
          propertyName: "isBeta",
          propertyType: "boolean",
          operator: "eq",
          value: true,
          thenValue: true,
        },
      ],
    },
    { name: "showBanner", value: true },
  ],
  remoteConfig: [
    {
      name: "welcomeText",
      value: "Welcome, visitor",
      ruleSet: [
        {
          propertyName: "isBeta",
          propertyType: "boolean",
          operator: "eq",
          value: true,
          thenValue: "Welcome, beta tester",
        },
      ],
    },
    { name: "buttonSuffix", value: "Local demo" },
  ],
};
