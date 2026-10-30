export const D1_BOOKMARK_HEADER = "x-d1-bookmark";

const STORAGE_PREFIX = "same-word-d1-bookmark:";

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope.trim().toUpperCase()}`;
}

export function readD1Bookmark(scope: string) {
  if (typeof window === "undefined" || !scope.trim()) return null;
  try {
    return window.localStorage.getItem(storageKey(scope));
  } catch {
    return null;
  }
}

export function saveD1Bookmark(response: Response, scopes: Array<string | null | undefined>) {
  const bookmark = response.headers.get(D1_BOOKMARK_HEADER);
  if (!bookmark || typeof window === "undefined") return;
  try {
    for (const scope of new Set(scopes.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))) {
      window.localStorage.setItem(storageKey(scope), bookmark);
    }
  } catch {
    // The response still works if this browser blocks local storage.
  }
}
