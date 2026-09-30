import { HttpService } from "@tryabby/core";
import Cookie from "js-cookie";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.spyOn(HttpService, "sendData").mockImplementation(() => undefined);
  for (const name of Object.keys(Cookie.get() ?? {})) Cookie.remove(name);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const name of Object.keys(Cookie.get() ?? {})) Cookie.remove(name);
});
