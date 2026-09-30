# Offline Vue integration demo

A Vue 3 + TypeScript + Vite app exercising `@tryabby/vue`. It uses render functions,
so no Vue SFC compiler plugin is required. The repository's AGPL-3.0 license applies.

## Run

From the repository root (Node >= 22.8, pnpm 9.9):

```sh
pnpm install
pnpm --filter @tryabby/core build
pnpm --filter @tryabby/vue build
pnpm --filter vue-example dev
```

Open `http://localhost:5173`. To verify a production bundle of this **demo**:

```sh
pnpm --filter vue-example typecheck
pnpm --filter vue-example build
pnpm --filter vue-example preview
```

No Abby account, project, API key, or paid service is needed. `src/abby.ts` supplies
fixture `initialData` to `AbbyProvider`. Its single nonzero A/B weight ensures the
initial control assignment is deterministic. Each reload uses a fresh demo-only
cookie namespace so earlier local overrides/consent do not affect the fixture.
The config's custom `fetch` fails closed rather than loading project data.

## Try it

1. The initial button uses the typed `useAbby("checkout", lookup)` control value.
   Clicking calls `onAct`, but consent is initially off, so no event call is recorded
   and no A/B assignment cookie is written.
2. Turn on “Target as a beta tester”. `updateUserProperties` immediately changes
   the targeted feature flag and welcome remote config. Turn it off to check their
   fallback values. These values are separate from the local override controls.
3. Allow cookies/event calls. An exposure (`PING`) appears in the local log;
   clicking the experiment adds an action (`ACT`). Disable consent and repeat:
   no new events are recorded and A/B assignment cookies are removed.
4. Use control/treatment, toggle the local feature flag, or apply new button text.
   These controls call core `updateLocalVariant`, `updateFlag`, and
   `updateRemoteConfig` through `useAbbyClient().abby`. Computed refs refresh from
   the core subscription. Local override cookies are a development convenience;
   A/B tracking consent is separate from feature-flag/remote-config overrides.
5. Unmount the experiment. Its exposure watcher and subscription are disposed.
   Remounting creates a new exposure only when consent allows it. The provider
   remains mounted and intentionally retains this factory's data and overrides.

## Event log and network behavior

`src/main.ts` intentionally replaces `HttpService.sendData` with a local recorder
**for this demo only**. This shows that the integration called the event transport;
it does not claim that Abby received an event. It also guarantees no event requests
when previewing on `127.0.0.1` or another hostname. The unmodified core transport
already suppresses event delivery on `localhost`. Do not copy the recorder into a
real application.

Vite is configured with `NODE_ENV = "development"` even in the demo preview build,
so core development overrides behave the same in both runs. A real production app
must use its normal production environment rather than this demo setting.

API details, plugin installation, SSR ownership, and a request-scoped Nuxt recipe
are in [`packages/vue/README.md`](../../packages/vue/README.md).
