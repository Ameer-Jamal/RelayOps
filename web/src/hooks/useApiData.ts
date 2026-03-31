import { useCallback, useEffect, useState } from "react";

export function useApiData<T>(loader: () => Promise<T>, immediate = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(immediate);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loader();
      setData(next);
      return next;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    if (!immediate) {
      return;
    }

    void reload().catch(() => undefined);
  }, [immediate, reload]);

  return {
    data,
    loading,
    error,
    reload,
    setData
  };
}
