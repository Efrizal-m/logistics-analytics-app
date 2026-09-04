import { useCallback, useEffect, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Minimal fetch-on-mount hook. A query cache would earn its place if this app
 * had many overlapping requests; it has four endpoints and no refetching, so
 * a dependency here would be weight without benefit.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  const run = useCallback(fn, deps);

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: null, loading: true });
    run()
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error: Error) =>
        !cancelled && setState({ data: null, error: error.message, loading: false }),
      );
    return () => {
      cancelled = true;
    };
  }, [run]);

  return state;
}
