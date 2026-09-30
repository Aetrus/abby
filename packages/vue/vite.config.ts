import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    environmentOptions: { jsdom: { url: "https://vue.example.test" } },
  },
});
