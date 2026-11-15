export const DEMO_MODE_STORAGE_KEY = "neurovision.web.demo-mode";

type DemoModeReader = Pick<Storage, "getItem"> | null;
type DemoModeWriter = Pick<Storage, "setItem" | "removeItem"> | null;

function sessionStore(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/** Demo mode is off unless sessionStorage holds "on". Survives navigation, not new tabs. */
export function readDemoMode(storage?: DemoModeReader): boolean {
  try {
    const store = storage === undefined ? sessionStore() : storage;
    if (!store) return false;
    return store.getItem(DEMO_MODE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeDemoMode(on: boolean, storage?: DemoModeWriter): boolean {
  try {
    const store = storage === undefined ? sessionStore() : storage;
    if (!store) return on;
    if (on) store.setItem(DEMO_MODE_STORAGE_KEY, "on");
    else store.removeItem(DEMO_MODE_STORAGE_KEY);
  } catch {
    /* preference just won't persist */
  }
  return on;
}
