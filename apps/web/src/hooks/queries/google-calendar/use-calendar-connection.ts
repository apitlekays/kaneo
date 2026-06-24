import { useQuery } from "@tanstack/react-query";
import { getCalendarStatus } from "@/fetchers/google-calendar";

export function useCalendarConnection() {
  return useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: getCalendarStatus,
  });
}
