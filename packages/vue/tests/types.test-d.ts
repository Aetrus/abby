import * as validation from "@tryabby/core/validation";
import { assertType, expectTypeOf } from "vitest";
import { type ComputedRef, defineComponent, ref } from "vue";
import { createAbby, defineConfig } from "../src";

const sdk = createAbby(
  defineConfig(
    { projectId: "types", currentEnvironment: "test" },
    {
      environments: ["test"],
      tests: { button: { variants: ["A", "B"] }, other: { variants: ["X"] } },
      flags: ["premium", "beta"],
      remoteConfig: { label: "String", price: "Number", options: "JSON" },
      user: {
        premium: validation.boolean(),
        age: validation.number(),
        name: validation.optional(validation.string()),
      },
    }
  )
);

defineComponent({
  setup() {
    const raw = sdk.useAbby("button");
    expectTypeOf(raw.variant).toEqualTypeOf<ComputedRef<"A" | "B">>();
    expectTypeOf(raw.onAct).toEqualTypeOf<() => void>();
    const mapped = sdk.useAbby("button", { A: 1, B: "two" });
    expectTypeOf(mapped.variant).toEqualTypeOf<ComputedRef<1 | "two">>();
    expectTypeOf(sdk.useFeatureFlag("premium")).toEqualTypeOf<
      ComputedRef<boolean>
    >();
    expectTypeOf(sdk.useRemoteConfig("label")).toEqualTypeOf<
      ComputedRef<string>
    >();
    expectTypeOf(sdk.useRemoteConfig("price")).toEqualTypeOf<
      ComputedRef<number>
    >();
    expectTypeOf(sdk.useRemoteConfig("options")).toEqualTypeOf<
      ComputedRef<Record<string, unknown>>
    >();
    const dynamic = ref<"label" | "price">("label");
    expectTypeOf(sdk.useRemoteConfig(dynamic)).toEqualTypeOf<
      ComputedRef<string | number>
    >();
    expectTypeOf(sdk.useFeatureFlag(() => "premium" as const)).toEqualTypeOf<
      ComputedRef<boolean>
    >();
    // @ts-expect-error Unknown tests are rejected.
    sdk.useAbby("missing");
    // @ts-expect-error Every configured variant needs a lookup value.
    sdk.useAbby("button", { A: "one" });
    // @ts-expect-error Unknown feature flags are rejected.
    sdk.useFeatureFlag("missing");
    // @ts-expect-error Unknown remote configs are rejected.
    sdk.useRemoteConfig("missing");
    return () => null;
  },
});
expectTypeOf(sdk.getABTestValue("button")).toEqualTypeOf<"A" | "B">();
expectTypeOf(sdk.getABTestValue("button", { A: 1, B: 2 })).toEqualTypeOf<
  1 | 2
>();
expectTypeOf(sdk.getRemoteConfig("price")).toEqualTypeOf<number>();
expectTypeOf(sdk.getVariants("button")).toEqualTypeOf<readonly ["A", "B"]>();
assertType<boolean>(sdk.getFeatureFlagValue("premium"));
sdk.updateUserProperties({ premium: true, age: 21, name: "Ada" });
sdk.updateUserProperties({ name: undefined });
// @ts-expect-error User properties retain their configured types.
sdk.updateUserProperties({ premium: "true" });
// @ts-expect-error Unknown user properties are rejected.
sdk.updateUserProperties({ missing: true });
// @ts-expect-error Core overrides retain valid variant names.
sdk.__abby__.updateLocalVariant("button", "invalid");
// @ts-expect-error Direct getters reject unknown tests.
sdk.getABTestValue("missing");
// @ts-expect-error Reset helpers reject unknown tests.
sdk.getABResetFunction("missing");
const flagsOnly = createAbby({
  projectId: "flags",
  currentEnvironment: "test",
  environments: ["test"],
  flags: ["flag"],
});
assertType<boolean>(flagsOnly.getFeatureFlagValue("flag"));
const testsOnly = createAbby({
  projectId: "tests",
  currentEnvironment: "test",
  environments: ["test"],
  tests: { test: { variants: ["only"] } },
});
expectTypeOf(testsOnly.getABTestValue("test")).toEqualTypeOf<"only">();
const remoteOnly = createAbby({
  projectId: "remote",
  currentEnvironment: "test",
  environments: ["test"],
  remoteConfig: { value: "String" },
});
assertType<string>(remoteOnly.getRemoteConfig("value"));
