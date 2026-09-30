import {
  type ABConfig,
  Abby,
  type AbbyConfig,
  type AbbyDataResponse,
  AbbyEventType,
  HttpService,
  type RemoteConfigValueString,
  type RemoteConfigValueStringToType,
  type ValidatorType,
  getABStorageKey,
  getFFStorageKey,
  getRCStorageKey,
} from "@tryabby/core";
import type { Infer } from "@tryabby/core/validation";
import {
  type App,
  type DefineComponent,
  type InjectionKey,
  type MaybeRefOrGetter,
  type PropType,
  type Ref,
  type ShallowRef,
  computed,
  defineComponent,
  getCurrentInstance,
  inject,
  onMounted,
  onScopeDispose,
  onUnmounted,
  provide,
  readonly,
  ref,
  shallowRef,
  toValue,
  watch,
} from "vue";
import { createStorage } from "./StorageService";

export { type ABConfig, type AbbyConfig, defineConfig } from "@tryabby/core";

export type ABTestReturnValue<Lookup, Variant> = Lookup extends undefined
  ? Variant
  : Variant extends keyof Lookup
    ? Lookup[Variant]
    : never;

export interface AbbyProviderOptions {
  initialData?: AbbyDataResponse;
}

/** Create one instance per app (and per SSR request). No browser work happens here. */
export function createAbby<
  const FlagName extends string,
  const Tests extends Record<string, ABConfig>,
  const RemoteConfig extends Record<RemoteConfigName, RemoteConfigValueString>,
  const RemoteConfigName extends Extract<keyof RemoteConfig, string>,
  const User extends Record<string, ValidatorType> = Record<
    string,
    ValidatorType
  >,
>(
  abbyConfig: AbbyConfig<
    FlagName,
    Tests,
    string[],
    RemoteConfigName,
    RemoteConfig,
    User
  >
) {
  type TestName = Extract<keyof Tests, string>;
  // Core updates test weights and cookie settings. Never mutate a reusable config.
  const config = {
    ...abbyConfig,
    tests: Object.fromEntries(
      Object.entries(abbyConfig.tests ?? {}).map(([name, test]) => [
        name,
        { ...test, variants: [...test.variants] },
      ])
    ) as unknown as Tests,
    cookies: { ...abbyConfig.cookies, disableByDefault: true },
  };
  const cookiesEnabled = ref(!abbyConfig.cookies?.disableByDefault);
  const isReady = ref(false);
  let active = false;
  let consentChanged = false;
  let subscribers = 0;
  let unsubscribe: (() => void) | undefined;
  let loadPromise: Promise<void> | undefined;
  let loaded = false;
  let generation = 0;
  const storage = createStorage(
    config.projectId,
    () => active && !config.cookies.disableByDefault,
    () => subscribers > 0
  );
  const abby = new Abby<
    FlagName,
    TestName,
    Tests,
    RemoteConfig,
    RemoteConfigName,
    string[],
    User
  >(config, storage.tests, storage.flags, storage.remoteConfig);
  const data: ShallowRef<ReturnType<typeof abby.getProjectData>> = shallowRef(
    abby.getProjectData()
  );
  const refresh = () => {
    data.value = abby.getProjectData();
  };
  const takeHydrationSnapshot = () => ({
    tests: abby.getProjectData().tests,
    flags: Object.fromEntries(
      (config.flags ?? []).map((name) => [name, abby.getFeatureFlag(name)])
    ) as Record<FlagName, boolean>,
    remoteConfig: Object.fromEntries(
      Object.keys(config.remoteConfig ?? {}).map((name) => [
        name,
        abby.getRemoteConfig(name as RemoteConfigName),
      ])
    ) as Record<
      RemoteConfigName,
      RemoteConfigValueStringToType<RemoteConfig[RemoteConfigName]>
    >,
    flagList: abby.getFeatureFlags(),
    remoteConfigList: abby.getRemoteConfigVariables(),
  });
  // Every component needs the same first render, including deferred Suspense children.
  const hydration = shallowRef(takeHydrationSnapshot());
  const overrideKeys = new Set([
    ...Object.keys(config.tests).map((name) =>
      getABStorageKey(config.projectId, name)
    ),
    ...(config.flags ?? []).map((name) =>
      getFFStorageKey(config.projectId, name)
    ),
    ...Object.keys(config.remoteConfig ?? {}).map((name) =>
      getRCStorageKey(config.projectId, name)
    ),
  ]);
  const applyCookieOverrides = () => {
    if (!active) return;
    if (!consentChanged) {
      const consent = storage.readConsent();
      if (consent !== null) cookiesEnabled.value = consent === "true";
    } else {
      storage.writeConsent(cookiesEnabled.value);
    }
    config.cookies.disableByDefault = !cookiesEnabled.value;
    // Keep consent authority here. Core receives only configured override cookies.
    abby.setLocalOverrides(storage.readOverrides(overrideKeys));
  };
  const initialize = (initialData: AbbyDataResponse) => {
    generation++;
    loaded = true;
    // Cookie reads during setup would make server/client hydration disagree.
    abby.init(initialData, { cookies: false });
    applyCookieOverrides();
    refresh();
    if (subscribers === 0) hydration.value = takeHydrationSnapshot();
    if (subscribers > 0) void activate();
  };
  const loadProjectData = async () => {
    if (loadPromise) return loadPromise;
    const currentGeneration = generation;
    loadPromise = (async () => {
      const response = await HttpService.getProjectData({
        projectId: config.projectId,
        environment: config.currentEnvironment,
        url: config.apiUrl,
        fetch: config.fetch,
        __experimentalCdnUrl: config.__experimentalCdnUrl
          ? `${config.__experimentalCdnUrl}/${config.projectId}/${config.currentEnvironment}`
          : undefined,
      });
      if (currentGeneration !== generation) return;
      if (response) abby.init(response, { cookies: false });
      applyCookieOverrides();
      loaded = true;
      refresh();
      if (subscribers === 0) hydration.value = takeHydrationSnapshot();
    })().finally(() => {
      loadPromise = undefined;
    });
    return loadPromise;
  };
  const activate = async () => {
    if (!loaded) await loadProjectData();
    if (subscribers === 0 || active) return;
    active = true;
    applyCookieOverrides();
    refresh();
    isReady.value = true;
  };
  const acquire = () => {
    subscribers++;
    if (!unsubscribe) unsubscribe = abby.subscribe(refresh);
    void activate();
    return () => {
      subscribers--;
      if (subscribers !== 0) return;
      unsubscribe?.();
      unsubscribe = undefined;
      active = false;
      isReady.value = false;
      // Server and first hydrated client render use deterministic variants.
      config.cookies.disableByDefault = true;
    };
  };
  const enableCookies = () => {
    consentChanged = true;
    cookiesEnabled.value = true;
    config.cookies.disableByDefault = !active;
    storage.clearVariants();
    storage.writeConsent(true);
    refresh();
  };
  const disableCookies = () => {
    consentChanged = true;
    cookiesEnabled.value = false;
    config.cookies.disableByDefault = true;
    storage.writeConsent(false);
    for (const name of Object.keys(config.tests)) storage.removeTest(name);
    refresh();
  };
  const updateUserProperties = (
    user: Partial<{ -readonly [K in keyof User]: Infer<User[K]> }>
  ) => {
    abby.updateUserProperties(user);
    refresh();
    if (subscribers === 0) hydration.value = takeHydrationSnapshot();
  };
  const runtime = {
    abby,
    data,
    isReady: readonly(isReady) as Readonly<Ref<boolean>>,
    cookiesEnabled: readonly(cookiesEnabled) as Readonly<Ref<boolean>>,
    enableCookies,
    disableCookies,
    updateUserProperties,
    loadProjectData,
  };
  const key: InjectionKey<typeof runtime> = Symbol("Abby");
  const useRuntime = () => {
    const context = inject(key);
    if (!context) {
      throw new Error(
        "Abby composables must be used within this instance's AbbyProvider or an app using app.use(abby)."
      );
    }
    // Reference-counted subscriptions also work when installed as a Vue plugin.
    let release: (() => void) | undefined;
    let disposed = false;
    onMounted(() => {
      if (!disposed) release = acquire();
    });
    onScopeDispose(() => {
      disposed = true;
      release?.();
      release = undefined;
    });
    return context;
  };
  const useMounted = () => {
    const mounted = ref(false);
    let disposed = false;
    onMounted(() => {
      if (!disposed) mounted.value = true;
    });
    onScopeDispose(() => {
      disposed = true;
      mounted.value = false;
    });
    onUnmounted(() => {
      mounted.value = false;
    });
    return mounted;
  };
  const AbbyProvider: DefineComponent<{ initialData?: AbbyDataResponse }> =
    defineComponent({
      name: "AbbyProvider",
      props: {
        initialData: Object as PropType<AbbyDataResponse>,
      },
      setup(props, { slots }) {
        provide(key, runtime);
        watch(
          () => props.initialData,
          (initialData) => {
            if (initialData) initialize(initialData);
          },
          { immediate: true }
        );
        let release: (() => void) | undefined;
        onMounted(() => {
          release = acquire();
        });
        onScopeDispose(() => release?.());
        return () => slots.default?.();
      },
    });
  const useAbby = <
    const K extends TestName,
    const Lookup extends
      | Record<Tests[K]["variants"][number], unknown>
      | undefined = undefined,
  >(
    name: MaybeRefOrGetter<K>,
    lookupObject?: Lookup
  ) => {
    const context = useRuntime();
    const mounted = useMounted();
    const selectedVariant = computed(() => {
      if (!mounted.value) {
        return hydration.value.tests[toValue(name)]
          ?.selectedVariant as Tests[K]["variants"][number];
      }
      context.data.value;
      return context.abby.getTestVariant(toValue(name));
    });
    const variant = computed<
      ABTestReturnValue<Lookup, Tests[K]["variants"][number]>
    >(() => {
      const selected = selectedVariant.value;
      return (
        lookupObject ? lookupObject[selected] : selected
      ) as ABTestReturnValue<Lookup, Tests[K]["variants"][number]>;
    });
    const sendEvent = (type: AbbyEventType) => {
      const selected = selectedVariant.value;
      if (
        !mounted.value ||
        !context.isReady.value ||
        !context.cookiesEnabled.value ||
        !selected
      ) {
        return;
      }
      HttpService.sendData({
        url: config.apiUrl,
        type,
        data: {
          projectId: config.projectId,
          testName: toValue(name),
          selectedVariant: selected,
        },
      });
    };
    // Track exposures only after loading/consent, and whenever the selection changes.
    watch(
      [
        mounted,
        context.isReady,
        context.cookiesEnabled,
        () => toValue(name),
        selectedVariant,
      ],
      () => sendEvent(AbbyEventType.PING),
      { flush: "post" }
    );
    return { variant, onAct: () => sendEvent(AbbyEventType.ACT) };
  };
  const useFeatureFlag = (name: MaybeRefOrGetter<FlagName>) => {
    const context = useRuntime();
    const mounted = useMounted();
    return computed(() => {
      if (!mounted.value) return hydration.value.flags[toValue(name)];
      context.data.value;
      return context.abby.getFeatureFlag(toValue(name));
    });
  };
  const useRemoteConfig = <const T extends RemoteConfigName>(
    name: MaybeRefOrGetter<T>
  ) => {
    const context = useRuntime();
    const mounted = useMounted();
    return computed<RemoteConfigValueStringToType<RemoteConfig[T]>>(() => {
      if (!mounted.value) {
        return hydration.value.remoteConfig[
          toValue(name)
        ] as RemoteConfigValueStringToType<RemoteConfig[T]>;
      }
      context.data.value;
      return context.abby.getRemoteConfig(toValue(name));
    });
  };
  const useFeatureFlags = () => {
    const context = useRuntime();
    const mounted = useMounted();
    return computed(() => {
      if (!mounted.value) return hydration.value.flagList;
      context.data.value;
      return context.abby.getFeatureFlags();
    });
  };
  const useRemoteConfigVariables = () => {
    const context = useRuntime();
    const mounted = useMounted();
    return computed(() => {
      if (!mounted.value) return hydration.value.remoteConfigList;
      context.data.value;
      return context.abby.getRemoteConfigVariables();
    });
  };
  const getABTestValue = <
    const K extends TestName,
    const Lookup extends
      | Record<Tests[K]["variants"][number], unknown>
      | undefined = undefined,
  >(
    name: K,
    lookupObject?: Lookup
  ): ABTestReturnValue<Lookup, Tests[K]["variants"][number]> => {
    const selected = abby.getTestVariant(name);
    return (
      lookupObject ? lookupObject[selected] : selected
    ) as ABTestReturnValue<Lookup, Tests[K]["variants"][number]>;
  };
  const withDevtools = <Factory extends { create: (props: any) => () => void }>(
    factory: Factory,
    props: Omit<Parameters<Factory["create"]>[0], "abby"> & {
      dangerouslyForceShow?: boolean;
    }
  ): DefineComponent =>
    defineComponent({
      name: "AbbyDevtools",
      setup() {
        const context = useRuntime();
        let destroy: (() => void) | undefined;
        onMounted(() => {
          if (
            !props.dangerouslyForceShow &&
            process.env.NODE_ENV !== "development"
          ) {
            return;
          }
          destroy = factory.create({ ...props, abby: context.abby });
        });
        onScopeDispose(() => destroy?.());
        return () => null;
      },
    });

  return {
    AbbyProvider,
    useAbby,
    useFeatureFlag,
    useRemoteConfig,
    useFeatureFlags,
    useRemoteConfigVariables,
    useAbbyClient: useRuntime,
    getFeatureFlagValue: (name: FlagName) => abby.getFeatureFlag(name),
    getRemoteConfig: <T extends RemoteConfigName>(name: T) =>
      abby.getRemoteConfig(name),
    getABTestValue,
    getVariants: <T extends TestName>(name: T) => abby.getVariants(name),
    getABResetFunction:
      <T extends TestName>(name: T) =>
      () => {
        storage.removeTest(name);
        refresh();
      },
    updateUserProperties,
    enableCookies,
    disableCookies,
    loadProjectData,
    withDevtools,
    __abby__: abby,
    install(app: App, options: AbbyProviderOptions = {}) {
      if (options.initialData) initialize(options.initialData);
      app.provide(key, runtime);
    },
    provideAbby(options: AbbyProviderOptions = {}) {
      if (!getCurrentInstance()) {
        throw new Error(
          "provideAbby must be called within a component's setup()."
        );
      }
      if (options.initialData) initialize(options.initialData);
      provide(key, runtime);
    },
  };
}
