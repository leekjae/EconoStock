import { useQuery } from "@tanstack/react-query";
import { fetchKrx } from "@/lib/krx-api";

export function useGenericKrxData<T>(endpoint: string | undefined, basDd: string | undefined) {
  return useQuery<T[]>({
    queryKey: ["krx", endpoint, basDd],
    queryFn: () => fetchKrx<T>(endpoint!, basDd!),
    enabled: !!endpoint && !!basDd,
    staleTime: 5 * 60 * 1000,
  });
}
