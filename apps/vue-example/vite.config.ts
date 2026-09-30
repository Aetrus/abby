import { defineConfig } from "vite";

export default defineConfig({
  // The core SDK also uses NODE_ENV to gate development overrides.
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  server: { port: 5173, strictPort: true },
});
