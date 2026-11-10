// Small per-device preferences in localStorage, as JSON. Storage can be blocked (a private window,
// cleared site data): a read then gives the fallback and a write is forgotten.

export function readStored<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(window.localStorage.getItem(key) ?? "null") as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

// null removes the key
export function writeStored(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Forgotten, as in a private window
  }
}
