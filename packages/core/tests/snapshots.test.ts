import {
  Abby,
  type AbbyDataResponse,
  getABStorageKey,
  getFFStorageKey,
} from "../src/index";
import * as validation from "../src/validation";

const targetedData: AbbyDataResponse = {
  tests: [],
  flags: [
    {
      name: "targetedFlag",
      value: false,
      ruleSet: [
        {
          propertyName: "eligible",
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
      name: "message",
      value: "baseline",
      ruleSet: [
        {
          propertyName: "eligible",
          propertyType: "boolean",
          operator: "eq",
          value: true,
          thenValue: "targeted",
        },
      ],
    },
  ],
};

function createTargetedAbby() {
  return new Abby({
    environments: ["test"],
    currentEnvironment: "test",
    projectId: "targeting-snapshots",
    flags: ["targetedFlag"],
    remoteConfig: { message: "String" },
    user: { eligible: validation.boolean() },
  });
}

describe("project data snapshots", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns to raw server values when targeting stops matching", () => {
    const abby = createTargetedAbby();
    const initial = abby.init(targetedData);
    const listener = vi.fn();
    abby.subscribe(listener);

    abby.updateUserProperties({ eligible: true });
    const matching = abby.getProjectData();
    expect(matching.flags.targetedFlag.value).toBe(true);
    expect(matching.remoteConfig.message.value).toBe("targeted");

    abby.updateUserProperties({ eligible: false });
    const nonmatching = abby.getProjectData();
    expect(nonmatching.flags.targetedFlag.value).toBe(false);
    expect(nonmatching.remoteConfig.message.value).toBe("baseline");
    expect(abby.getFeatureFlag("targetedFlag")).toBe(false);
    expect(abby.getRemoteConfig("message")).toBe("baseline");

    expect(initial.flags.targetedFlag.value).toBe(false);
    expect(initial.remoteConfig.message.value).toBe("baseline");
    expect(matching.flags.targetedFlag.value).toBe(true);
    expect(matching.remoteConfig.message.value).toBe("targeted");
    expect(
      listener.mock.calls.map(([snapshot]) => snapshot.flags.targetedFlag.value)
    ).toEqual([true, false]);
    expect(
      listener.mock.calls.map(
        ([snapshot]) => snapshot.remoteConfig.message.value
      )
    ).toEqual(["targeted", "baseline"]);
    expect(initial.flags).not.toBe(matching.flags);
    expect(matching.flags).not.toBe(nonmatching.flags);
    expect(initial.remoteConfig).not.toBe(matching.remoteConfig);
    expect(matching.remoteConfig).not.toBe(nonmatching.remoteConfig);
  });

  it("preserves server baselines when the user matches before init", () => {
    const abby = createTargetedAbby();
    abby.updateUserProperties({ eligible: true });

    const matching = abby.init(targetedData);
    expect(matching.flags.targetedFlag.value).toBe(true);
    expect(matching.remoteConfig.message.value).toBe("targeted");

    abby.updateUserProperties({ eligible: false });
    expect(abby.getFeatureFlag("targetedFlag")).toBe(false);
    expect(abby.getRemoteConfig("message")).toBe("baseline");
    expect(matching.flags.targetedFlag.value).toBe(true);
    expect(matching.remoteConfig.message.value).toBe("targeted");
  });

  it("keeps older snapshots and test configuration unchanged after overrides", () => {
    vi.stubEnv("NODE_ENV", "development");
    const tests = { experiment: { variants: ["first", "second"] } };
    const abby = new Abby({
      environments: ["test"],
      currentEnvironment: "test",
      projectId: "override-snapshots",
      flags: ["flag"],
      remoteConfig: { message: "String" },
      tests,
      cookies: { disableByDefault: true },
    });
    const initial = abby.init({
      tests: [{ name: "experiment", weights: [1, 0] }],
      flags: [{ name: "flag", value: false }],
      remoteConfig: [{ name: "message", value: "baseline" }],
    });

    abby.updateFlag("flag", true);
    abby.updateRemoteConfig("message", "overridden");
    abby.updateLocalVariant("experiment", "second");
    const updated = abby.getProjectData();

    expect(initial.flags.flag.value).toBe(false);
    expect(initial.remoteConfig.message.value).toBe("baseline");
    expect(initial.tests.experiment.selectedVariant).toBe("first");
    expect(updated.flags.flag.value).toBe(true);
    expect(updated.remoteConfig.message.value).toBe("overridden");
    expect(updated.tests.experiment.selectedVariant).toBe("second");
    expect(updated.tests).not.toBe(initial.tests);
    expect(updated.tests.experiment).not.toBe(initial.tests.experiment);
    expect(tests).toEqual({ experiment: { variants: ["first", "second"] } });
  });
});

describe("missing remote config values", () => {
  const fetchEmptyData = () =>
    vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ tests: [], flags: [], remoteConfig: [] }),
        }) as Response
    );

  it("uses each type's default after fetching a response without the declared keys", async () => {
    const fetch = fetchEmptyData();
    const abby = new Abby({
      environments: ["test"],
      currentEnvironment: "test",
      projectId: "missing-remote-config",
      remoteConfig: { text: "String", count: "Number", json: "JSON" },
      fetch,
    });

    await abby.getProjectDataAsync();

    expect(fetch).toHaveBeenCalledOnce();
    expect(abby.getRemoteConfig("text")).toBe("");
    expect(abby.getRemoteConfig("count")).toBe(0);
    expect(abby.getRemoteConfig("json")).toEqual({});
  });

  it("preserves configured fallbacks and type defaults for omitted keys", async () => {
    const abby = new Abby({
      environments: ["test"],
      currentEnvironment: "test",
      projectId: "missing-configured-remote-config",
      remoteConfig: {
        textFallback: "String",
        countFallback: "Number",
        jsonFallback: "JSON",
        textDefault: "String",
        countDefault: "Number",
        jsonDefault: "JSON",
      },
      settings: {
        remoteConfig: {
          fallbackValues: {
            textFallback: "",
            countFallback: 0,
            jsonFallback: { source: "fallback" },
          },
          defaultValues: {
            String: "configured",
            Number: 42,
            JSON: { source: "default" },
          },
        },
      },
      fetch: fetchEmptyData(),
    });

    await abby.loadProjectData();

    expect(abby.getRemoteConfig("textFallback")).toBe("");
    expect(abby.getRemoteConfig("countFallback")).toBe(0);
    expect(abby.getRemoteConfig("jsonFallback")).toEqual({
      source: "fallback",
    });
    expect(abby.getRemoteConfig("textDefault")).toBe("configured");
    expect(abby.getRemoteConfig("countDefault")).toBe(42);
    expect(abby.getRemoteConfig("jsonDefault")).toEqual({ source: "default" });
  });
});

describe("initialization cookie overrides", () => {
  const projectId = "init-cookie-options";
  const cookieKey = getFFStorageKey(projectId, "flag");
  const data: AbbyDataResponse = {
    tests: [],
    flags: [{ name: "flag", value: false }],
    remoteConfig: [],
  };

  beforeEach(() => {
    document.cookie = `${cookieKey}=true; path=/`;
  });

  afterEach(() => {
    document.cookie = `${cookieKey}=; max-age=0; path=/`;
  });

  function createAbby() {
    return new Abby({
      environments: ["test"],
      currentEnvironment: "test",
      projectId,
      flags: ["flag"],
    });
  }

  it("skips browser cookie overrides when cookies is false", () => {
    const abby = createAbby();
    const initial = abby.init(data, { cookies: false });

    expect(initial.flags.flag.value).toBe(false);
    expect(abby.getFeatureFlag("flag")).toBe(false);

    abby.setLocalOverrides(document.cookie);
    expect(abby.getFeatureFlag("flag")).toBe(true);
  });

  it("continues applying browser cookie overrides by default", () => {
    const abby = createAbby();
    const initial = abby.init(data);

    expect(initial.flags.flag.value).toBe(true);
    expect(abby.getFeatureFlag("flag")).toBe(true);
  });
});

describe("stale test variant cookies", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["development", "production"])(
    "falls back to configured variants for removed cookie values in %s",
    (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      const projectId = "stale-variant-cookies";
      const abby = new Abby(
        {
          environments: ["test"],
          currentEnvironment: "test",
          projectId,
          tests: { experiment: { variants: ["first", "second"] } },
          cookies: { disableByDefault: true },
        },
        { get: () => "removed", set: vi.fn() }
      );

      abby.setLocalOverrides(
        `${getABStorageKey(projectId, "experiment")}=removed`
      );

      expect(abby.getTestVariant("experiment")).toBe("first");
    }
  );

  it("ignores a removed development override and keeps a valid persisted variant", () => {
    vi.stubEnv("NODE_ENV", "development");
    const projectId = "valid-persisted-variant";
    const abby = new Abby(
      {
        environments: ["test"],
        currentEnvironment: "test",
        projectId,
        tests: { experiment: { variants: ["first", "second"] } },
        cookies: { disableByDefault: true },
      },
      { get: () => "second", set: vi.fn() }
    );

    abby.setLocalOverrides(
      `${getABStorageKey(projectId, "experiment")}=removed`
    );

    expect(abby.getTestVariant("experiment")).toBe("second");
  });
});
