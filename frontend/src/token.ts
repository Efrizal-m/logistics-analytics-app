/**
 * Where the session token lives in the browser. Zero imports, deliberately -
 * api/client.ts reads from here and session.ts writes here, and keeping this
 * module dependency-free avoids a client.ts <-> session.ts import cycle.
 *
 * Same shape as theme.ts's localStorage convention: a namespaced key, a
 * reader that try/catches down to a safe default, a writer that try/catches
 * and silently no-ops (Safari private mode, storage disabled, etc.).
 */

const STORAGE_KEY = "la-auth-token";
const USERNAME_KEY = "la-auth-username";

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Cosmetic only (e.g. "Signed in as admin" in the masthead) - never trust
 * this for anything that matters, since it isn't verified against the token.
 * The token itself is what the server checks. */
export function readStoredUsername(): string | null {
  try {
    return localStorage.getItem(USERNAME_KEY);
  } catch {
    return null;
  }
}

export function writeStoredSession(token: string | null, username: string | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(USERNAME_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, token);
      if (username !== null) localStorage.setItem(USERNAME_KEY, username);
    }
  } catch {
    /* storage unavailable - the session just won't persist across reloads */
  }
}
