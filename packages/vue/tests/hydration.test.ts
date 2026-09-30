import {
  type AbbyDataResponse,
  getABStorageKey,
  getFFStorageKey,
  getRCStorageKey,
} from "@tryabby/core";
import { renderToString } from "@vue/server-renderer";
import { flushPromises } from "@vue/test-utils";
import Cookie from "js-cookie";
import { createSSRApp, defineComponent, h } from "vue";
import { createAbby } from "../src";

it("hydrates the deterministic server variant before applying saved client cookies", async () => {
  const config = {
    projectId: "hydrate",
    currentEnvironment: "production",
    environments: ["production"],
    tests: { button: { variants: ["A", "B"] } },
  };
  const initialData: AbbyDataResponse = {
    tests: [{ name: "button", weights: [1, 0] }],
    flags: [],
    remoteConfig: [],
  };
  const createTree = () => {
    const sdk = createAbby(config);
    const Consumer = defineComponent({
      setup() {
        const test = sdk.useAbby("button");
        return () => h("span", test.variant.value);
      },
    });
    const app = createSSRApp({
      render: () =>
        h(sdk.AbbyProvider, { initialData }, { default: () => h(Consumer) }),
    });
    return app;
  };
  Cookie.set(getABStorageKey("hydrate", "button"), "B");
  // Server-style render must not consult browser cookies even in this jsdom test.
  const html = await renderToString(createTree());
  expect(html).toContain("<span>A</span>");
  const container = document.createElement("div");
  container.innerHTML = html;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = createTree();
  app.mount(container);
  await flushPromises();
  expect(container.textContent).toBe("B");
  expect(warn.mock.calls.flat().join(" ")).not.toContain("Hydration");
  expect(error.mock.calls.flat().join(" ")).not.toContain("Hydration");
  app.unmount();
});

it("hydrates an async consumer before applying already-active sibling cookies", async () => {
  const config = {
    projectId: "hydrate-async",
    currentEnvironment: "production",
    environments: ["production"],
    tests: { button: { variants: ["A", "B"] } },
    flags: ["enabled"],
    remoteConfig: { label: "String" as const },
  };
  const initialData: AbbyDataResponse = {
    tests: [{ name: "button", weights: [1, 0] }],
    flags: [{ name: "enabled", value: false }],
    remoteConfig: [{ name: "label", value: "Server" }],
  };
  const { defineAsyncComponent, Suspense } = await import("vue");
  const build = (deferred = false) => {
    const sdk = createAbby(config);
    const Consumer = defineComponent({
      setup() {
        const test = sdk.useAbby("button");
        const flag = sdk.useFeatureFlag("enabled");
        const label = sdk.useRemoteConfig("label");
        return () =>
          h("span", `${test.variant.value}:${flag.value}:${label.value}`);
      },
    });
    let resolve: () => void = () => {};
    const AsyncConsumer = defineAsyncComponent(() =>
      deferred
        ? new Promise<typeof Consumer>((done) => {
            resolve = () => done(Consumer);
          })
        : Promise.resolve(Consumer)
    );
    const app = createSSRApp({
      render: () =>
        h(
          sdk.AbbyProvider,
          { initialData },
          {
            default: () =>
              h("div", [
                h(Consumer),
                h(Suspense, null, { default: () => h(AsyncConsumer) }),
              ]),
          }
        ),
    });
    return { app, resolve: () => resolve() };
  };
  Cookie.set(getABStorageKey("hydrate-async", "button"), "B");
  Cookie.set(getFFStorageKey("hydrate-async", "enabled"), "true");
  Cookie.set(getRCStorageKey("hydrate-async", "label"), "Client");
  const html = await renderToString(build().app);
  expect(html).toContain(
    "<span>A:false:Server</span><span>A:false:Server</span>"
  );
  const container = document.createElement("div");
  container.innerHTML = html;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { app, resolve } = build(true);
  app.mount(container);
  await flushPromises();
  resolve();
  await flushPromises();
  expect(container.textContent).toBe("B:true:ClientB:true:Client");
  expect(warn.mock.calls.flat().join(" ")).not.toContain("Hydration");
  expect(error.mock.calls.flat().join(" ")).not.toContain("Hydration");
  app.unmount();
});
