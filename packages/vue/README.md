# @tryabby/vue

Typed, reactive Abby integration for **Vue 3.3 or later**, for SPAs and SSR apps.
It supports Nuxt through a request-scoped Vue plugin recipe below; there is no
separate Nuxt module. The repository's AGPL-3.0 license applies.

## Install

```sh
pnpm add @tryabby/vue @tryabby/core vue
```

`vue` is a peer dependency (`^3.3.0`). The optional `@tryabby/devtools` package is
only needed if you use the devtools adapter. `@tryabby/core` is listed explicitly
because the examples import its validation helpers and response type.

## Create an instance

Keep literal names in the configuration to infer test names, variants, flag names,
remote-config types, and user-property types. `defineConfig` takes **two arguments**:
dynamic project/environment settings, then the feature definitions.

```ts
// src/abby.ts — a client-only SPA may share this instance across its components
import { createAbby, defineConfig } from "@tryabby/vue";
import { boolean } from "@tryabby/core/validation";

export const config = defineConfig(
  { projectId: "YOUR_PROJECT_ID", currentEnvironment: "development" },
  {
    environments: ["development", "production"],
    tests: { checkout: { variants: ["control", "treatment"] } },
    flags: ["betaDashboard"],
    remoteConfig: { buttonText: "String", maxItems: "Number", theme: "JSON" },
    user: { isBeta: boolean() },
    cookies: { disableByDefault: true },
  }
);

export const abby = createAbby(config);
```

One `createAbby` call owns one core instance. Its provider, plugin, composables,
user properties, overrides, and consent intentionally share that instance. Create
separate factories for independent apps/projects and **one factory per SSR
request**. Never export a module-level instance used by multiple server requests.
Nested providers from the same factory also share its state; they are not isolated
stores. Composables must come from the same factory as their provider/plugin.

### Vue plugin

```ts
// src/main.ts
import { createApp } from "vue";
import App from "./App.vue";
import { abby } from "./abby";

const app = createApp(App);
app.use(abby); // or app.use(abby, { initialData })
app.mount("#app");
```

The plugin provides the instance to all components. Without `initialData`, the
instance loads project data once when a consumer mounts, using `apiUrl` and the
configured `fetch` if supplied. Data loading is shared across consumers.

### Provider and initial data

Use the provider instead of installing the plugin when you want an explicit
component boundary. The slot's descendants can use the factory's composables.

```vue
<!-- App.vue -->
<script setup lang="ts">
import type { AbbyDataResponse } from "@tryabby/core";
import { abby } from "./abby";
import CheckoutButton from "./CheckoutButton.vue";

const AbbyProvider = abby.AbbyProvider;
const initialData: AbbyDataResponse = {
  tests: [{ name: "checkout", weights: [1, 0] }],
  flags: [{ name: "betaDashboard", value: false }],
  remoteConfig: [
    { name: "buttonText", value: "Check out" },
    { name: "maxItems", value: 5 },
    { name: "theme", value: { color: "indigo" } },
  ],
};
</script>

<template>
  <AbbyProvider :initial-data="initialData">
    <CheckoutButton />
  </AbbyProvider>
</template>
```

Passing `initialData` initializes synchronously, supports server rendering and
hydration, and avoids an initial live API request. Supply the same data on the
server and first client render. Updating the provider's `initialData` reference
reinitializes project data. Do not supply competing initial data to providers
sharing a factory.

An ancestor can alternatively call `abby.provideAbby({ initialData })` inside its
`setup()`. Its descendants can then call the composables. Vue's `provide` does not
make the value injectable into that same component; use the factory's ordinary
methods there, or install the plugin above it.

## Reactive composables

Call composables during component `setup()` (including `<script setup>`). A missing
provider/plugin throws a descriptive error. Names accept a literal, a ref, or a
getter (`MaybeRefOrGetter`); changing a name also recomputes the result.

### A/B tests and typed lookup values

```vue
<!-- CheckoutButton.vue -->
<script setup lang="ts">
import { abby } from "./abby";

const { variant, onAct } = abby.useAbby("checkout", {
  control: { label: "Check out", color: "indigo" },
  treatment: { label: "Try express checkout", color: "orange" },
});
const hasBetaDashboard = abby.useFeatureFlag("betaDashboard");
const buttonText = abby.useRemoteConfig("buttonText");
const maxItems = abby.useRemoteConfig("maxItems");

// JavaScript uses .value; inferred types are the lookup value, boolean, string, number.
console.log(variant.value.label, hasBetaDashboard.value, buttonText.value, maxItems.value);
</script>

<template>
  <!-- Top-level refs are automatically unwrapped in Vue templates. -->
  <button :style="{ color: variant.color }" @click="onAct">{{ variant.label }}</button>
  <p v-if="hasBetaDashboard">Beta dashboard is available</p>
  <p>{{ buttonText }} · up to {{ maxItems }} items</p>
</template>
```

Without a lookup, `abby.useAbby("checkout").variant` is a
`ComputedRef<"control" | "treatment">`. A lookup must cover all variants; its value
type is inferred. `onAct()` records an action for the current selection when
mounted, ready, and consented. Exposures are recorded after loading settles and
when the test or selected variant changes, subject to the same gates.

- `useFeatureFlag(name)` returns `ComputedRef<boolean>`
- `useRemoteConfig(name)` returns `ComputedRef<string>`, `ComputedRef<number>`, or
  `ComputedRef<Record<string, unknown>>` according to the declared type
- `useFeatureFlags()` returns a computed list of `{ name, value }`
- `useRemoteConfigVariables()` returns a computed list of `{ name, value }`

In render functions, use `.value` too. A ref returned by `useFeatureFlag` is an
object; testing the ref itself as a boolean would always be truthy.

### Scoped client, targeting, and consent

```ts
// Within a descendant component's setup()
const client = abby.useAbbyClient();
client.updateUserProperties({ isBeta: true }); // validated and typed; rules recompute
client.enableCookies();
client.disableCookies();
console.log(client.isReady.value, client.cookiesEnabled.value);
```

`useAbbyClient()` exposes `abby` (the raw core instance), read-only `isReady` and
`cookiesEnabled` refs, and scoped `updateUserProperties`, `enableCookies`,
`disableCookies`, and `loadProjectData` methods. The factory also exposes these
methods directly. Use these scoped consent methods so the reactive tracking gate
stays in sync; do not bypass it through the raw core consent methods.

With `cookies.disableByDefault: true`, no A/B assignment cookies are written and no
A/B event transport calls occur until consent is enabled. `disableCookies()` stops
events, removes A/B assignment cookies, and records a consent preference while
mounted. Flag/remote-config development-override cookies are separate. Server
rendering and pre-mount setup do not read/write browser cookies or emit events.
The initial selection is deterministic (highest weight, or first variant), then
consented client assignments may use weighted random selection and persistence.

Targeting properties are evaluated locally against the supplied rule sets. Core
updates and local overrides notify the integration and refresh the computed refs.
Subscriptions and watchers are cleaned up when their component scopes are disposed.

### Non-composable helpers and escape hatch

These do not require component setup and return ordinary values, not reactive refs:

```ts
abby.getABTestValue("checkout");
abby.getABTestValue("checkout", { control: 1, treatment: 2 });
abby.getFeatureFlagValue("betaDashboard");
abby.getRemoteConfig("buttonText");
abby.getVariants("checkout");
abby.getABResetFunction("checkout")();
```

`getABResetFunction` clears the persisted assignment, allowing reassignment on the
next evaluation; it does not clear an explicit development override. Use helpers
only after initialization when you need loaded values. `loadProjectData()` is an
explicit refresh and may fetch even if initial data was supplied.

`abby.__abby__` and `client.abby` expose the underlying core SDK. For example, local
overrides used by devtools can also be set manually:

```ts
const core = abby.__abby__;
core.updateLocalVariant("checkout", "treatment");
core.updateFlag("betaDashboard", true);
core.updateRemoteConfig("buttonText", "Continue");
```

Core A/B development overrides are honored in development; these helpers do not
change the remote project. The mounted integration subscribes to the notifications.

## Optional devtools

```ts
import DevtoolsFactory from "@tryabby/devtools";
import { abby } from "./abby";

export const AbbyDevtools = abby.withDevtools(DevtoolsFactory, {
  position: "bottom-right",
  defaultShow: true,
});
```

Render `<AbbyDevtools />` below the same provider or in a plugin-enabled app. The
adapter accepts a structural factory with `create(props) => cleanup`, so importing
`@tryabby/vue` alone does not pull in devtools. Creation happens after mount only in
development, and the cleanup runs on disposal. `dangerouslyForceShow: true` opts
into other environments. In Nuxt, keep devtools in a client-only component/plugin.

## Nuxt 3: one instance per request

Every consumer uses the same deterministic initial snapshot until its own mount, including deferred async/Suspense children. After mount, its refs switch to live reactive values and browser overrides.

Create the instance **inside** a Nuxt plugin invocation. A pure configuration
factory can be shared; a server-side core instance cannot. Fetch initial project
data on the server and put the serializable response into Nuxt's payload. The
client then installs its own instance with the same response.

```ts
// utils/create-project-abby.ts
import { createAbby, defineConfig } from "@tryabby/vue";

export function createProjectAbby(projectId: string) {
  return createAbby(defineConfig(
    { projectId, currentEnvironment: "production" },
    {
      environments: ["production"],
      tests: { checkout: { variants: ["control", "treatment"] } },
      flags: ["betaDashboard"],
      remoteConfig: { buttonText: "String" },
      cookies: { disableByDefault: true },
    }
  ));
}
```

```ts
// plugins/abby.ts
import { HttpService, type AbbyDataResponse } from "@tryabby/core";
import { createProjectAbby } from "~/utils/create-project-abby";

export default defineNuxtPlugin(async (nuxtApp) => {
  const projectId = useRuntimeConfig().public.abbyProjectId;
  const initialData = useState<AbbyDataResponse | null>("abby-data", () => null);
  if (import.meta.server) {
    initialData.value = await HttpService.getProjectData({
      projectId,
      environment: "production",
    });
  }
  const abby = createProjectAbby(projectId);
  nuxtApp.vueApp.use(abby, { initialData: initialData.value ?? undefined });
  return { provide: { abby } };
});
```

```ts
// nuxt.config.ts — environment variable NUXT_PUBLIC_ABBY_PROJECT_ID may override this
export default defineNuxtConfig({
  runtimeConfig: { public: { abbyProjectId: "YOUR_PROJECT_ID" } },
});
```

Nuxt infers `$abby` from the plugin's return. For an explicit type declaration:

```ts
// types/abby.d.ts
import type { createProjectAbby } from "../utils/create-project-abby";

declare module "#app" {
  interface NuxtApp {
    $abby: ReturnType<typeof createProjectAbby>;
  }
}
export {};
```

```vue
<script setup lang="ts">
const { $abby } = useNuxtApp();
const { variant, onAct } = $abby.useAbby("checkout");
const buttonText = $abby.useRemoteConfig("buttonText");
</script>

<template>
  <button @click="onAct">{{ buttonText }} ({{ variant }})</button>
</template>
```

Do not import a global singleton into Nuxt components. Use `useNuxtApp().$abby` so
each request uses the plugin's typed instance. If the server fetch fails, getters
use configured defaults and a mounted client can retry loading. A successful
initial response avoids the initial client fetch. Test with the same serialized
data on both sides before adding client-only targeting or consent updates.

## Offline example

[`apps/vue-example`](../../apps/vue-example/README.md) contains a deterministic Vue
+ TypeScript + Vite example with fixture data, lookup values, reactive targeting,
consent, mount/unmount, and local core override controls. No live API is required.
Its explicitly labeled event recorder intercepts transport calls locally; the
stock core also suppresses event delivery on `localhost`.
