import {
  type StorageServiceOptions,
  getABStorageKey,
  getFFStorageKey,
  getRCStorageKey,
} from "@tryabby/core";
import Cookie from "js-cookie";

export const COOKIE_CONSENT_KEY = "$_abcc_$";

/** Storage never touches browser APIs until the Vue application is mounted. */
export function createStorage(
  projectId: string,
  canPersist: () => boolean,
  isMounted: () => boolean
) {
  const variants = new Map<string, string>();
  const getCookie = (key: string) => {
    if (typeof document === "undefined" || !isMounted()) return null;
    return Cookie.get(key) ?? null;
  };
  const setCookie = (
    key: string,
    value: string,
    options?: StorageServiceOptions
  ) => {
    if (typeof document === "undefined" || !isMounted()) return;
    Cookie.set(key, value, { expires: options?.expiresInDays ?? 365 });
  };

  return {
    tests: {
      get(key: string) {
        if (!canPersist()) return null;
        return variants.get(key) ?? getCookie(getABStorageKey(projectId, key));
      },
      set(key: string, value: string, options?: StorageServiceOptions) {
        if (!canPersist()) return;
        variants.set(key, value);
        setCookie(getABStorageKey(projectId, key), value, options);
      },
    },
    flags: {
      get: (key: string) => getCookie(getFFStorageKey(projectId, key)),
      set: (key: string, value: string) =>
        setCookie(getFFStorageKey(projectId, key), value),
    },
    remoteConfig: {
      get: (key: string) => getCookie(getRCStorageKey(projectId, key)),
      set: (key: string, value: string) =>
        setCookie(getRCStorageKey(projectId, key), value),
    },
    readOverrides(keys: Set<string>) {
      if (typeof document === "undefined" || !isMounted()) return "";
      return Object.entries(Cookie.get() ?? {})
        .filter(([name]) => keys.has(name))
        .map(
          ([name, value]) =>
            `${encodeURIComponent(name)}=${encodeURIComponent(value)}`
        )
        .join("; ");
    },
    readConsent: () =>
      getCookie(getABStorageKey(projectId, COOKIE_CONSENT_KEY)),
    writeConsent: (enabled: boolean) =>
      setCookie(
        getABStorageKey(projectId, COOKIE_CONSENT_KEY),
        String(enabled)
      ),
    clearVariants() {
      variants.clear();
    },
    removeTest(name: string) {
      variants.delete(name);
      if (typeof document !== "undefined" && isMounted()) {
        Cookie.remove(getABStorageKey(projectId, name));
      }
    },
  };
}
