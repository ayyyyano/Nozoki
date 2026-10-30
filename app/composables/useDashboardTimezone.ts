/** Display timestamps in the configured site timezone, with the historical default fallback. */
export function useDashboardTimezone() {
  const shared = useSharedDashboard()
  return computed(() => shared.value?.site.timezone ?? 'Asia/Shanghai')
}
