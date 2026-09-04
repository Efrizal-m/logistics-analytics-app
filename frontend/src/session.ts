import { useCallback, useEffect, useState } from "react";
import { api, ApiError, setUnauthorizedHandler } from "./api/client";
import { readStoredToken, readStoredUsername, writeStoredSession } from "./token";

export interface Session {
  token: string | null;
  username: string | null;
  /** True right after a previously-valid session was force-cleared by a 401
   * from the server (an expired or revoked token) - distinct from never
   * having logged in, so the login form can say "your session expired"
   * instead of just presenting a blank form. Cleared on the next login. */
  expired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loggingIn: boolean;
  loginError: string | null;
}

/**
 * Mirrors theme.ts's shape: lazy-initialize from storage, expose a mutator
 * that writes through. The one addition is wiring into api/client.ts's
 * global 401 handler, since (unlike the theme) a session can be invalidated
 * by the server at any time, not just by user action here.
 */
export function useSession(): Session {
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [username, setUsername] = useState<string | null>(readStoredUsername);
  const [expired, setExpired] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Functional form: if a second, near-simultaneous 401 fires (the
      // dashboard's kpis + 5-chart fetch can both reject at once), React
      // bails out of the re-render when the updater returns the same
      // reference/value, so this collapses to one state change rather than
      // looping or double-clearing.
      setToken((current) => {
        if (current === null) return current;
        writeStoredSession(null, null);
        setExpired(true);
        return null;
      });
      setUsername(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (user: string, password: string) => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const result = await api.login(user, password);
      writeStoredSession(result.token, result.username);
      setToken(result.token);
      setUsername(result.username);
      setExpired(false);
    } catch (caught) {
      setLoginError(
        caught instanceof ApiError
          ? caught.message
          : "Could not reach the API. Check your connection and try again.",
      );
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Client-side only - the token itself stays valid server-side until it
    // expires on its own. There is no server-side revocation short of
    // rotating AUTH_SECRET, which would log out every session, not just one.
    writeStoredSession(null, null);
    setToken(null);
    setUsername(null);
    setExpired(false);
  }, []);

  return { token, username, expired, login, logout, loggingIn, loginError };
}
