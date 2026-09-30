import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Install only packed runtime dependencies, without workspace links or dev deps.
// Run after building @tryabby/core and @tryabby/vue: pnpm test:package
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = resolve(packageRoot, "../core");
const workdir = mkdtempSync(join(tmpdir(), "abby-vue-package-"));
const env = {
  ...process.env,
  npm_config_cache: join(tmpdir(), "abby-vue-package-cache"),
};
const run = (command, args, cwd = workdir) => {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
};
const manager = process.env.npm_execpath;
const pack = (cwd) => {
  if (manager)
    run(
      process.execPath,
      [manager, "pack", "--pack-destination", workdir],
      cwd
    );
  else run("pnpm", ["pack", "--pack-destination", workdir], cwd);
};
pack(coreRoot);
pack(packageRoot);
const tarball = (prefix) =>
  join(
    workdir,
    readdirSync(workdir).find(
      (name) => name.startsWith(prefix) && name.endsWith(".tgz")
    )
  );
writeFileSync(
  join(workdir, "package.json"),
  JSON.stringify({
    name: "abby-vue-packed-consumer",
    private: true,
    type: "module",
  })
);
run("npm", [
  "install",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  tarball("tryabby-core-"),
  tarball("tryabby-vue-"),
  "vue@3.5.13",
  "typescript@5.5.4",
]);
writeFileSync(
  join(workdir, "consumer.ts"),
  `
import { createAbby, defineConfig } from "@tryabby/vue";
import { boolean } from "@tryabby/core/validation";
import { createApp, defineComponent, h, type ComputedRef } from "vue";
const sdk = createAbby(defineConfig(
  { projectId: "packed", currentEnvironment: "test" },
  { environments: ["test"], flags: ["enabled"], tests: { button: { variants: ["A", "B"] } }, remoteConfig: { label: "String", count: "Number", json: "JSON" }, user: { enabled: boolean() } }
));
const App = defineComponent({ setup() {
  const flag: ComputedRef<boolean> = sdk.useFeatureFlag("enabled");
  const count: ComputedRef<number> = sdk.useRemoteConfig("count");
  const json: ComputedRef<Record<string, unknown>> = sdk.useRemoteConfig("json");
  const variant: ComputedRef<"A" | "B"> = sdk.useAbby("button").variant;
  const mapped: ComputedRef<1 | "two"> = sdk.useAbby("button", { A: 1, B: "two" }).variant;
  // @ts-expect-error Packaged names remain strict.
  sdk.useFeatureFlag("missing");
  // @ts-expect-error Packaged variant mappings remain exhaustive.
  sdk.useAbby("button", { A: 1 });
  void [flag, count, json, variant, mapped];
  return () => null;
} });
createApp(App).use(sdk);
h(sdk.AbbyProvider, { initialData: { tests: [], flags: [], remoteConfig: [] } }, () => h(App));
const Devtools = sdk.withDevtools({ create(props: { abby: typeof sdk.__abby__; label: string }) { void props; return () => {}; } }, { label: "Demo" });
h(Devtools);
`
);
for (const moduleResolution of ["Bundler", "NodeNext"]) {
  writeFileSync(
    join(workdir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        target: "ES2020",
        module: moduleResolution === "NodeNext" ? "NodeNext" : "ESNext",
        moduleResolution,
        lib: ["ES2020", "DOM"],
      },
      include: ["consumer.ts"],
    })
  );
  run(process.execPath, [
    join(workdir, "node_modules/typescript/bin/tsc"),
    "--project",
    "tsconfig.json",
  ]);
}
run(process.execPath, [
  "--input-type=module",
  "-e",
  'import { createAbby } from "@tryabby/vue"; if (typeof createAbby !== "function") throw new Error("ESM import failed")',
]);
run(process.execPath, [
  "--input-type=commonjs",
  "-e",
  'const { createAbby } = require("@tryabby/vue"); if (typeof createAbby !== "function") throw new Error("CommonJS require failed")',
]);
// Verify declared minimum peer compatibility, including generated component types.
run("npm", [
  "install",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "vue@3.3.0",
  "zod@3.21.4",
]);
run(process.execPath, [
  join(workdir, "node_modules/typescript/bin/tsc"),
  "--project",
  "tsconfig.json",
]);
console.log(
  `Packed consumer checks passed (Vue 3.5.13 and 3.3.0, minimum zod 3.21.4, strict public types, ESM and CommonJS). Artifacts: ${workdir}`
);
