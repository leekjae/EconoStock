import { useQueries } from "@tanstack/react-query";
import { fetchKrx } from "@/lib/krx-api";

/**
 * Fetch multiple KRX endpoints and merge results into a single array.
 * Used for "전체" market selections that need data from multiple APIs.
 */
export function useMultiKrxData<T>(
  endpoints: string[] | undefined,
  basDd: string | undefined
) {
  const queries = useQueries({
    queries: (endpoints || []).map((ep) => ({
      queryKey: ["krx", ep, basDd],
      queryFn: () => fetchKrx<T>(ep, basDd!),
      enabled: !!basDd && !!ep,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const data = queries.flatMap((q) => (q.data as T[]) || []);
  const error = queries.find((q) => q.error)?.error;

  return { data, isLoading, error };
}
