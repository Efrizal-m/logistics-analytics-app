import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api/client";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  status: number | null;
  /** "http" when the server responded with an error status, "network" when
   * the browser could not open a connection at all (a bad host, CORS, the
   * backend not running) - the two need different explanations to a user. */
  kind: "network" | "http" | null;
  failedAt: Date | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Fetch-on-mount, with a manual refetch for the error panel's Retry action. A
 * query cache would earn its place if this app had many overlapping
 * requests; it has a handful of endpoints, so a dependency here would be
 * weight without benefit.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, "refetch">>({
    data: null,
    error: null,
    status: null,
    kind: null,
    failedAt: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);

  const run = useCallback(fn, deps);

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null, status: null, kind: null, failedAt: null, loading: true });
    run()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, status: null, kind: null, failedAt: null, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof ApiError ? error.status : null;
        setState({
          data: null,
          error: message,
          status,
          kind: error instanceof ApiError ? "http" : "network",
          failedAt: new Date(),
          loading: false,
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, refetch };
}
