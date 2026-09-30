// @vitest-environment node
import { type AbbyDataResponse, HttpService } from "@tryabby/core";
import { renderToString } from "@vue/server-renderer";
import { createSSRApp, defineComponent, h } from "vue";
import { createAbby } from "../src";

const config = {
  projectId: "ssr",
  currentEnvironment: "production",
  environments: ["production"],
  tests: { button: { variants: ["A", "B"] } },
  flags: ["enabled"],
  remoteConfig: { label: "String" as const },
};
const initialData: AbbyDataResponse = {
  tests: [{ name: "button", weights: [0, 1] }],
  flags: [{ name: "enabled", value: true }],
  remoteConfig: [{ name: "label", value: "SSR label" }],
};

it("imports, creates and renders on the server without browser globals or events", async () => {
  expect(typeof window).toBe("undefined");
  const sdk = createAbby(config);
  const subscribe = vi.spyOn(sdk.__abby__, "subscribe");
  const Consumer = defineComponent({
    setup() {
      const { variant, onAct } = sdk.useAbby("button");
      const enabled = sdk.useFeatureFlag("enabled");
      const label = sdk.useRemoteConfig("label");
      onAct();
      return () => h("div", `${variant.value}:${enabled.value}:${label.value}`);
    },
  });
  const app = createSSRApp({
    render: () =>
      h(sdk.AbbyProvider, { initialData }, { default: () => h(Consumer) }),
  });
  expect(await renderToString(app)).toContain("B:true:SSR label");
  expect(HttpService.sendData).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
});

it("isolates data and consent across request-scoped instances sharing config", async () => {
  const originalConfig = JSON.stringify(config);
  const render = async (data: AbbyDataResponse) => {
    const sdk = createAbby(config);
    const Consumer = defineComponent({
      setup() {
        const label = sdk.useRemoteConfig("label");
        return () => h("span", label.value);
      },
    });
    const app = createSSRApp(Consumer);
    app.use(sdk, { initialData: data });
    return renderToString(app);
  };
  const [one, two] = await Promise.all([
    render(initialData),
    render({
      ...initialData,
      remoteConfig: [{ name: "label", value: "Other request" }],
    }),
  ]);
  expect(one).toBe("<span>SSR label</span>");
  expect(two).toBe("<span>Other request</span>");
  expect(JSON.stringify(config)).toBe(originalConfig);
});

it("does not load on the server when no initialData is supplied", async () => {
  const fetch = vi.fn();
  const sdk = createAbby({ ...config, fetch });
  const Consumer = defineComponent({
    setup() {
      const test = sdk.useAbby("button");
      return () => h("span", test.variant.value);
    },
  });
  const app = createSSRApp(Consumer);
  app.use(sdk);
  expect(await renderToString(app)).toBe("<span>A</span>");
  expect(fetch).not.toHaveBeenCalled();
});

it("renders explicitly prefetched project data through the SSR plugin", async () => {
  const fetch = vi.fn(
    async () => ({ ok: true, json: async () => initialData }) as Response
  );
  const sdk = createAbby({ ...config, fetch });
  await sdk.loadProjectData();
  expect(sdk.getABTestValue("button")).toBe("B");
  const Consumer = defineComponent({
    setup() {
      const test = sdk.useAbby("button");
      const flag = sdk.useFeatureFlag("enabled");
      const label = sdk.useRemoteConfig("label");
      return () =>
        h("span", `${test.variant.value}:${flag.value}:${label.value}`);
    },
  });
  const app = createSSRApp(Consumer);
  app.use(sdk);
  expect(await renderToString(app)).toBe("<span>B:true:SSR label</span>");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(HttpService.sendData).not.toHaveBeenCalled();
});
