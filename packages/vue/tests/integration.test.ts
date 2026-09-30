import {
  type AbbyDataResponse,
  AbbyEventType,
  HttpService,
  getABStorageKey,
  getFFStorageKey,
  getRCStorageKey,
} from "@tryabby/core";
import * as validation from "@tryabby/core/validation";
import { flushPromises, mount } from "@vue/test-utils";
import Cookie from "js-cookie";
import { createApp, defineComponent, effectScope, h, nextTick, ref } from "vue";
import { createAbby } from "../src";

const initialData: AbbyDataResponse = {
  tests: [{ name: "button", weights: [1, 0] }],
  flags: [{ name: "premium", value: false }],
  remoteConfig: [
    { name: "label", value: "Buy now" },
    { name: "price", value: 12 },
    { name: "options", value: { color: "blue" } },
  ],
};

const makeAbby = (projectId = "vue-tests", disableByDefault = false) =>
  createAbby({
    projectId,
    apiUrl: "https://abby.example.test/",
    currentEnvironment: "test",
    environments: ["test"],
    tests: {
      button: { variants: ["A", "B"] },
      other: { variants: ["X"] },
    },
    flags: ["premium", "otherFlag"],
    remoteConfig: { label: "String", price: "Number", options: "JSON" },
    user: { premium: validation.boolean() },
    cookies: { disableByDefault },
  });

function renderConsumer<T>(
  sdk: ReturnType<typeof makeAbby>,
  setup: () => T,
  data = initialData
) {
  let result: T;
  const Consumer = defineComponent({
    setup() {
      result = setup();
      return () => h("div", "consumer");
    },
  });
  const wrapper = mount(sdk.AbbyProvider, {
    props: { initialData: data },
    slots: { default: () => h(Consumer) },
  });
  return { wrapper, result: () => result };
}

it("returns the current typed values and sends exposure/action events", async () => {
  const sdk = makeAbby();
  const { wrapper, result } = renderConsumer(sdk, () => ({
    test: sdk.useAbby("button"),
    flag: sdk.useFeatureFlag("premium"),
    label: sdk.useRemoteConfig("label"),
    price: sdk.useRemoteConfig("price"),
    options: sdk.useRemoteConfig("options"),
  }));
  await flushPromises();
  expect(result().test.variant.value).toBe("A");
  expect(result().flag.value).toBe(false);
  expect(result().label.value).toBe("Buy now");
  expect(result().price.value).toBe(12);
  expect(result().options.value).toEqual({ color: "blue" });
  expect(HttpService.sendData).toHaveBeenCalledTimes(1);
  expect(HttpService.sendData).toHaveBeenLastCalledWith({
    url: "https://abby.example.test/",
    type: AbbyEventType.PING,
    data: { projectId: "vue-tests", testName: "button", selectedVariant: "A" },
  });
  result().test.onAct();
  expect(HttpService.sendData).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: AbbyEventType.ACT })
  );
  wrapper.unmount();
});

it("reacts to core overrides and computes lookup values", async () => {
  const sdk = makeAbby();
  const { wrapper, result } = renderConsumer(sdk, () => ({
    test: sdk.useAbby("button", { A: "Original", B: "New" }),
    flag: sdk.useFeatureFlag("premium"),
    label: sdk.useRemoteConfig("label"),
    flags: sdk.useFeatureFlags(),
    configs: sdk.useRemoteConfigVariables(),
  }));
  await flushPromises();
  sdk.__abby__.updateLocalVariant("button", "B");
  sdk.__abby__.updateFlag("premium", true);
  sdk.__abby__.updateRemoteConfig("label", "Changed");
  await nextTick();
  expect(result().test.variant.value).toBe("New");
  expect(result().flag.value).toBe(true);
  expect(result().label.value).toBe("Changed");
  expect(result().flags.value).toContainEqual({ name: "premium", value: true });
  expect(result().configs.value).toContainEqual({
    name: "label",
    value: "Changed",
  });
  expect(sdk.getFeatureFlagValue("premium")).toBe(true);
  expect(sdk.getRemoteConfig("label")).toBe("Changed");
  expect(sdk.getABTestValue("button", { A: 1, B: 2 })).toBe(2);
  expect(sdk.getVariants("button")).toEqual(["A", "B"]);
  wrapper.unmount();
});

it("accepts reactive names without losing reactivity", async () => {
  const sdk = makeAbby();
  const name = ref<"button" | "other">("button");
  const flagName = ref<"premium" | "otherFlag">("premium");
  const configName = ref<"label" | "price">("label");
  const { wrapper, result } = renderConsumer(sdk, () => ({
    test: sdk.useAbby(name),
    flag: sdk.useFeatureFlag(() => flagName.value),
    config: sdk.useRemoteConfig(configName),
  }));
  await flushPromises();
  sdk.__abby__.updateFlag("otherFlag", true);
  name.value = "other";
  flagName.value = "otherFlag";
  configName.value = "price";
  await nextTick();
  expect(result().test.variant.value).toBe("X");
  expect(result().flag.value).toBe(true);
  expect(result().config.value).toBe(12);
  result().test.onAct();
  expect(HttpService.sendData).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        testName: "other",
        selectedVariant: "X",
      }),
    })
  );
  wrapper.unmount();
});

it("reevaluates user targeting in both directions", async () => {
  const sdk = makeAbby();
  const targeting: AbbyDataResponse = {
    ...initialData,
    flags: [
      {
        name: "premium",
        value: false,
        ruleSet: [
          {
            propertyName: "premium",
            propertyType: "boolean",
            operator: "eq",
            value: true,
            thenValue: true,
          },
        ],
      },
    ],
    remoteConfig: [
      {
        name: "label",
        value: "Guest",
        ruleSet: [
          {
            propertyName: "premium",
            propertyType: "boolean",
            operator: "eq",
            value: true,
            thenValue: "Member",
          },
        ],
      },
    ],
  };
  const { wrapper, result } = renderConsumer(
    sdk,
    () => ({
      flag: sdk.useFeatureFlag("premium"),
      label: sdk.useRemoteConfig("label"),
    }),
    targeting
  );
  await flushPromises();
  sdk.updateUserProperties({ premium: true });
  await nextTick();
  expect(result().flag.value).toBe(true);
  expect(result().label.value).toBe("Member");
  sdk.updateUserProperties({ premium: false });
  await nextTick();
  expect(result().flag.value).toBe(false);
  expect(result().label.value).toBe("Guest");
  expect(() => sdk.updateUserProperties({ premium: "bad" as any })).toThrow(
    "Expected boolean"
  );
  wrapper.unmount();
});

it("loads via custom fetch using the configured environment and URL", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => initialData });
  const sdk = createAbby({
    projectId: "fetch-project",
    apiUrl: "https://api.example.test/",
    fetch,
    currentEnvironment: "staging",
    environments: ["staging"],
    flags: ["premium"],
    tests: { button: { variants: ["A", "B"] } },
  });
  let value: ReturnType<typeof sdk.useFeatureFlag>;
  const Consumer = defineComponent({
    setup() {
      value = sdk.useFeatureFlag("premium");
      return () => null;
    },
  });
  const wrapper = mount(sdk.AbbyProvider, {
    slots: { default: () => h(Consumer) },
  });
  await flushPromises();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    "https://api.example.test/api/v2/data/fetch-project?environment=staging"
  );
  expect(value!.value).toBe(false);
  wrapper.unmount();
});

it("supports a CDN and does not request the API when initialData is supplied", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => initialData });
  const sdk = createAbby({
    projectId: "cdn",
    currentEnvironment: "prod",
    environments: ["prod"],
    __experimentalCdnUrl: "https://cdn.example.test",
    fetch,
    flags: ["premium"],
  });
  const Consumer = defineComponent({
    setup() {
      sdk.useFeatureFlag("premium");
      return () => null;
    },
  });
  let wrapper = mount(sdk.AbbyProvider, {
    slots: { default: () => h(Consumer) },
  });
  await flushPromises();
  expect(fetch).toHaveBeenCalledWith("https://cdn.example.test/cdn/prod");
  wrapper.unmount();
  fetch.mockClear();
  wrapper = mount(sdk.AbbyProvider, {
    props: { initialData },
    slots: { default: () => h(Consumer) },
  });
  await flushPromises();
  expect(fetch).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("keeps fallback values usable after a failed fetch", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const sdk = createAbby({
    projectId: "offline",
    currentEnvironment: "test",
    environments: ["test"],
    fetch: vi.fn().mockRejectedValue(new Error("offline")),
    flags: ["premium"],
    remoteConfig: { label: "String" },
    settings: { remoteConfig: { defaultValues: { String: "Offline" } } },
  });
  let label: ReturnType<typeof sdk.useRemoteConfig>;
  let ready: ReturnType<typeof sdk.useAbbyClient>["isReady"];
  const Consumer = defineComponent({
    setup() {
      label = sdk.useRemoteConfig("label");
      ready = sdk.useAbbyClient().isReady;
      return () => null;
    },
  });
  const wrapper = mount(sdk.AbbyProvider, {
    slots: { default: () => h(Consumer) },
  });
  await flushPromises();
  expect(label!.value).toBe("Offline");
  expect(ready!.value).toBe(true);
  expect(error).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

it("does not assign or track before fetched test weights arrive", async () => {
  let resolve: (value: any) => void;
  const fetch = vi.fn(
    () =>
      new Promise<any>((done) => {
        resolve = done;
      })
  );
  const sdk = createAbby({
    projectId: "pending",
    currentEnvironment: "test",
    environments: ["test"],
    fetch,
    tests: { button: { variants: ["A", "B"] } },
  });
  let test: ReturnType<typeof sdk.useAbby>;
  const Consumer = defineComponent({
    setup() {
      test = sdk.useAbby("button");
      return () => null;
    },
  });
  const wrapper = mount(sdk.AbbyProvider, {
    slots: { default: () => h(Consumer) },
  });
  expect(test!.variant.value).toBe("A");
  expect(Cookie.get(getABStorageKey("pending", "button"))).toBeUndefined();
  test!.onAct();
  expect(HttpService.sendData).not.toHaveBeenCalled();
  resolve!({
    ok: true,
    json: async () => ({
      ...initialData,
      tests: [{ name: "button", weights: [0, 1] }],
    }),
  });
  await flushPromises();
  expect(test!.variant.value).toBe("B");
  expect(Cookie.get(getABStorageKey("pending", "button"))).toBe("B");
  expect(HttpService.sendData).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

it("ignores stale fetched data when newer initialData arrives", async () => {
  let resolve: (value: any) => void;
  const fetch = vi.fn(
    () =>
      new Promise<any>((done) => {
        resolve = done;
      })
  );
  const sdk = createAbby({
    projectId: "race",
    currentEnvironment: "test",
    environments: ["test"],
    fetch,
    flags: ["premium"],
    tests: { button: { variants: ["A", "B"] } },
  });
  let flag: ReturnType<typeof sdk.useFeatureFlag>;
  let ready: ReturnType<typeof sdk.useAbbyClient>["isReady"];
  let test: ReturnType<typeof sdk.useAbby>;
  const Consumer = defineComponent({
    setup() {
      flag = sdk.useFeatureFlag("premium");
      ready = sdk.useAbbyClient().isReady;
      test = sdk.useAbby("button");
      return () => null;
    },
  });
  const wrapper = mount(sdk.AbbyProvider, {
    slots: { default: () => h(Consumer) },
  });
  await wrapper.setProps({
    initialData: { ...initialData, flags: [{ name: "premium", value: true }] },
  });
  await flushPromises();
  expect(ready!.value).toBe(true);
  expect(flag!.value).toBe(true);
  test!.onAct();
  expect(HttpService.sendData).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: AbbyEventType.ACT })
  );
  resolve!({ ok: true, json: async () => initialData });
  await flushPromises();
  expect(flag!.value).toBe(true);
  wrapper.unmount();
});

it("reads persisted test, flag and remote-config overrides after mount", async () => {
  Cookie.set(getABStorageKey("saved", "button"), "B");
  Cookie.set(getFFStorageKey("saved", "premium"), "true");
  Cookie.set(getRCStorageKey("saved", "label"), "Saved label");
  const sdk = makeAbby("saved");
  const { wrapper, result } = renderConsumer(sdk, () => ({
    test: sdk.useAbby("button"),
    flag: sdk.useFeatureFlag("premium"),
    label: sdk.useRemoteConfig("label"),
  }));
  await flushPromises();
  expect(result().test.variant.value).toBe("B");
  expect(result().flag.value).toBe(true);
  expect(result().label.value).toBe("Saved label");
  wrapper.unmount();
});

it("honors opt-out, consent transitions and test-cookie cleanup", async () => {
  const sdk = makeAbby("consent", true);
  const { wrapper, result } = renderConsumer(sdk, () => sdk.useAbby("button"));
  await flushPromises();
  expect(Cookie.get(getABStorageKey("consent", "button"))).toBeUndefined();
  result().onAct();
  expect(HttpService.sendData).not.toHaveBeenCalled();
  sdk.enableCookies();
  await nextTick();
  expect(Cookie.get(getABStorageKey("consent", "button"))).toBe("A");
  expect(Cookie.get(getABStorageKey("consent", "$_abcc_$"))).toBe("true");
  expect(HttpService.sendData).toHaveBeenCalledTimes(1);
  sdk.disableCookies();
  await nextTick();
  expect(Cookie.get(getABStorageKey("consent", "button"))).toBeUndefined();
  expect(Cookie.get(getABStorageKey("consent", "$_abcc_$"))).toBe("false");
  result().onAct();
  expect(HttpService.sendData).toHaveBeenCalledTimes(1);
  sdk.enableCookies();
  await nextTick();
  expect(HttpService.sendData).toHaveBeenCalledTimes(2);
  wrapper.unmount();
});

it("honors saved consent even when config permits cookies", async () => {
  Cookie.set(getABStorageKey("denied", "$_abcc_$"), "false");
  Cookie.set(getABStorageKey("denied", "button"), "B");
  const sdk = makeAbby("denied");
  const { wrapper, result } = renderConsumer(sdk, () => sdk.useAbby("button"));
  await flushPromises();
  expect(result().variant.value).toBe("B"); // Devtools overrides retain precedence in development.
  result().onAct();
  expect(HttpService.sendData).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("keeps enabled variants stable when cookies cannot be written", async () => {
  vi.spyOn(Cookie, "set").mockImplementation(() => undefined);
  const sdk = makeAbby("blocked");
  const { wrapper, result } = renderConsumer(sdk, () => sdk.useAbby("button"));
  await flushPromises();
  const first = result().variant.value;
  for (let i = 0; i < 5; i++) sdk.__abby__.updateFlag("premium", i % 2 === 0);
  await nextTick();
  expect(result().variant.value).toBe(first);
  wrapper.unmount();
});

it("cleans up subscriptions and blocks action events after unmount", async () => {
  const sdk = makeAbby();
  const unsubscribe = vi.fn();
  const originalSubscribe = sdk.__abby__.subscribe.bind(sdk.__abby__);
  const subscribe = vi
    .spyOn(sdk.__abby__, "subscribe")
    .mockImplementation((listener) => {
      const stop = originalSubscribe(listener);
      return () => {
        unsubscribe();
        stop();
      };
    });
  const first = renderConsumer(sdk, () => ({
    test: sdk.useAbby("button"),
    flag: sdk.useFeatureFlag("premium"),
  }));
  await flushPromises();
  expect(subscribe).toHaveBeenCalledTimes(1);
  first.wrapper.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  const calls = vi.mocked(HttpService.sendData).mock.calls.length;
  first.result().test.onAct();
  sdk.__abby__.updateFlag("premium", true);
  await nextTick();
  expect(HttpService.sendData).toHaveBeenCalledTimes(calls);
  const second = renderConsumer(sdk, () => sdk.useAbby("button"));
  await flushPromises();
  expect(subscribe).toHaveBeenCalledTimes(2);
  expect(HttpService.sendData).toHaveBeenCalledTimes(calls + 1);
  second.wrapper.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it("handles a late consumer and removes the last provider while loading", async () => {
  const sdk = makeAbby();
  const visible = ref(false);
  let test: ReturnType<typeof sdk.useAbby>;
  const Consumer = defineComponent({
    setup() {
      test = sdk.useAbby("button");
      return () => null;
    },
  });
  const Parent = defineComponent({
    setup() {
      return () =>
        h(
          sdk.AbbyProvider,
          { initialData },
          { default: () => (visible.value ? h(Consumer) : null) }
        );
    },
  });
  const wrapper = mount(Parent);
  await flushPromises();
  expect(HttpService.sendData).not.toHaveBeenCalled();
  sdk.__abby__.updateLocalVariant("button", "B");
  visible.value = true;
  await nextTick();
  expect(test!.variant.value).toBe("B");
  expect(HttpService.sendData).toHaveBeenCalledTimes(1);
  visible.value = false;
  await nextTick();
  test!.onAct();
  expect(HttpService.sendData).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

it("never persists or tracks after unmount during a pending load", async () => {
  let resolve: (value: any) => void;
  const sdk = createAbby({
    projectId: "abandoned",
    currentEnvironment: "test",
    environments: ["test"],
    fetch: vi.fn(
      () =>
        new Promise<any>((done) => {
          resolve = done;
        })
    ),
    tests: { button: { variants: ["A", "B"] } },
  });
  const Consumer = defineComponent({
    setup() {
      sdk.useAbby("button");
      return () => null;
    },
  });
  const wrapper = mount(sdk.AbbyProvider, {
    slots: { default: () => h(Consumer) },
  });
  wrapper.unmount();
  resolve!({ ok: true, json: async () => initialData });
  await flushPromises();
  expect(Cookie.get(getABStorageKey("abandoned", "button"))).toBeUndefined();
  expect(HttpService.sendData).not.toHaveBeenCalled();
});

it("isolates separate instances and rejects a mismatched provider", async () => {
  const first = makeAbby("one");
  const second = makeAbby("two");
  const a = renderConsumer(first, () => first.useFeatureFlag("premium"));
  const b = renderConsumer(second, () => second.useFeatureFlag("premium"));
  await flushPromises();
  first.__abby__.updateFlag("premium", true);
  await nextTick();
  expect(a.result().value).toBe(true);
  expect(b.result().value).toBe(false);
  const error = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(() =>
    renderConsumer(first, () => second.useFeatureFlag("premium"))
  ).toThrow("Abby composables must be used");
  error.mockRestore();
  a.wrapper.unmount();
  b.wrapper.unmount();
});

it("supports the Vue plugin with cleanup when the app unmounts", async () => {
  const sdk = makeAbby("plugin");
  const container = document.createElement("div");
  const Component = defineComponent({
    setup() {
      const flag = sdk.useFeatureFlag("premium");
      return () => h("span", String(flag.value));
    },
  });
  const app = createApp(Component);
  app.use(sdk, { initialData });
  app.mount(container);
  await flushPromises();
  sdk.__abby__.updateFlag("premium", true);
  await nextTick();
  expect(container.textContent).toBe("true");
  app.unmount();
});

it("supports provideAbby from an ancestor setup", async () => {
  const sdk = makeAbby("provide");
  const Consumer = defineComponent({
    setup() {
      const label = sdk.useRemoteConfig("label");
      return () => h("span", label.value);
    },
  });
  const Parent = defineComponent({
    setup() {
      sdk.provideAbby({ initialData });
      return () => h(Consumer);
    },
  });
  const wrapper = mount(Parent);
  await flushPromises();
  expect(wrapper.text()).toBe("Buy now");
  expect(() => sdk.provideAbby()).toThrow("provideAbby must be called");
  wrapper.unmount();
});

it("initialData prop changes update existing consumers", async () => {
  const sdk = makeAbby();
  const { wrapper, result } = renderConsumer(sdk, () =>
    sdk.useRemoteConfig("label")
  );
  await flushPromises();
  await wrapper.setProps({
    initialData: {
      ...initialData,
      remoteConfig: [{ name: "label", value: "New response" }],
    },
  });
  expect(result().value).toBe("New response");
  wrapper.unmount();
});

it("devtools instantiate once per mount and clean up on remount", async () => {
  const sdk = makeAbby();
  const destroy = vi.fn();
  const factory = { create: vi.fn(() => destroy) };
  const Devtools = sdk.withDevtools(factory, {});
  let wrapper = mount(sdk.AbbyProvider, {
    props: { initialData },
    slots: { default: () => h(Devtools) },
  });
  await flushPromises();
  expect(factory.create).toHaveBeenCalledWith({ abby: sdk.__abby__ });
  wrapper.unmount();
  expect(destroy).toHaveBeenCalledTimes(1);
  wrapper = mount(sdk.AbbyProvider, {
    props: { initialData },
    slots: { default: () => h(Devtools) },
  });
  await flushPromises();
  expect(factory.create).toHaveBeenCalledTimes(2);
  wrapper.unmount();
  expect(destroy).toHaveBeenCalledTimes(2);
});

it("does not instantiate devtools in production unless forced", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const sdk = makeAbby();
  const factory = { create: vi.fn(() => vi.fn()) };
  let Devtools = sdk.withDevtools(factory, {});
  let wrapper = mount(sdk.AbbyProvider, {
    props: { initialData },
    slots: { default: () => h(Devtools) },
  });
  await flushPromises();
  expect(factory.create).not.toHaveBeenCalled();
  wrapper.unmount();
  Devtools = sdk.withDevtools(factory, { dangerouslyForceShow: true });
  wrapper = mount(sdk.AbbyProvider, {
    props: { initialData },
    slots: { default: () => h(Devtools) },
  });
  await flushPromises();
  expect(factory.create).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

it("does not mutate a reusable configuration", async () => {
  const config = {
    projectId: "config",
    currentEnvironment: "test",
    environments: ["test"],
    tests: { button: { variants: ["A", "B"] } },
    cookies: { disableByDefault: true },
  };
  const sdk = createAbby(config);
  const first = JSON.stringify(config);
  const Consumer = defineComponent({
    setup() {
      sdk.useAbby("button");
      return () => null;
    },
  });
  const wrapper = mount(sdk.AbbyProvider, {
    props: { initialData },
    slots: { default: () => h(Consumer) },
  });
  await flushPromises();
  sdk.enableCookies();
  expect(JSON.stringify(config)).toBe(first);
  wrapper.unmount();
});

it.each([true, false])(
  "keeps an explicit consent choice made during loading (saved %s)",
  async (saved) => {
    const projectId = `pending-consent-${saved}`;
    Cookie.set(getABStorageKey(projectId, "$_abcc_$"), String(saved));
    let resolve: (value: any) => void;
    const sdk = createAbby({
      projectId,
      currentEnvironment: "test",
      environments: ["test"],
      fetch: vi.fn(
        () =>
          new Promise<any>((done) => {
            resolve = done;
          })
      ),
      tests: { button: { variants: ["A", "B"] } },
    });
    let client: ReturnType<typeof sdk.useAbbyClient>;
    let test: ReturnType<typeof sdk.useAbby>;
    const Consumer = defineComponent({
      setup() {
        client = sdk.useAbbyClient();
        test = sdk.useAbby("button");
        return () => null;
      },
    });
    const wrapper = mount(sdk.AbbyProvider, {
      slots: { default: () => h(Consumer) },
    });
    if (saved) sdk.disableCookies();
    else sdk.enableCookies();
    expect(Cookie.get(getABStorageKey(projectId, "$_abcc_$"))).toBe(
      String(!saved)
    );
    expect(HttpService.sendData).not.toHaveBeenCalled();
    resolve!({ ok: true, json: async () => initialData });
    await flushPromises();
    expect(client!.cookiesEnabled.value).toBe(!saved);
    expect(client!.isReady.value).toBe(true);
    test!.onAct();
    if (saved) {
      expect(HttpService.sendData).not.toHaveBeenCalled();
      expect(Cookie.get(getABStorageKey(projectId, "button"))).toBeUndefined();
    } else {
      expect(HttpService.sendData).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: AbbyEventType.ACT })
      );
      expect(Cookie.get(getABStorageKey(projectId, "button"))).toBe("A");
    }
    wrapper.unmount();
  }
);

it("synchronizes saved consent after active initialData refreshes", async () => {
  const sdk = makeAbby("refresh-consent");
  const { wrapper, result } = renderConsumer(sdk, () => sdk.useAbby("button"));
  await flushPromises();
  const before = vi.mocked(HttpService.sendData).mock.calls.length;
  Cookie.set(getABStorageKey("refresh-consent", "$_abcc_$"), "false");
  await wrapper.setProps({ initialData: { ...initialData } });
  result().onAct();
  expect(HttpService.sendData).toHaveBeenCalledTimes(before);
  sdk.disableCookies();
  Cookie.set(getABStorageKey("refresh-consent", "$_abcc_$"), "true");
  await wrapper.setProps({ initialData: { ...initialData } });
  result().onAct();
  expect(HttpService.sendData).toHaveBeenCalledTimes(before);
  expect(Cookie.get(getABStorageKey("refresh-consent", "$_abcc_$"))).toBe(
    "false"
  );
  wrapper.unmount();
});

it("does not acquire a subscription for a scope disposed before mount", async () => {
  const sdk = makeAbby("disposed-before-mount");
  const subscribe = vi.spyOn(sdk.__abby__, "subscribe");
  let client: ReturnType<typeof sdk.useAbbyClient>;
  const Consumer = defineComponent({
    setup() {
      const scope = effectScope();
      scope.run(() => {
        client = sdk.useAbbyClient();
        sdk.useFeatureFlag("premium");
      });
      scope.stop();
      return () => null;
    },
  });
  const app = createApp(Consumer);
  app.use(sdk, { initialData });
  app.mount(document.createElement("div"));
  await flushPromises();
  expect(subscribe).not.toHaveBeenCalled();
  expect(client!.isReady.value).toBe(false);
  app.unmount();
  expect(client!.isReady.value).toBe(false);
});

it("blocks retained actions after a nested scope is disposed", async () => {
  const sdk = makeAbby("disposed-after-mount");
  const { wrapper, result } = renderConsumer(sdk, () => {
    const scope = effectScope();
    const test = scope.run(() => sdk.useAbby("button"))!;
    return { scope, test };
  });
  await flushPromises();
  const calls = vi.mocked(HttpService.sendData).mock.calls.length;
  expect(calls).toBe(1);
  result().scope.stop();
  result().test.onAct();
  sdk.__abby__.updateLocalVariant("button", "B");
  await nextTick();
  expect(HttpService.sendData).toHaveBeenCalledTimes(calls);
  wrapper.unmount();
});
