import type { DataStatus } from '../contracts/dashboard.ts'
/** A visible status stays separate from timestamps with different business meanings. */
export function summaryStatus(status: DataStatus) {
  return (
    (
      { stale: '已过期', error: '采集失败', offline: '来源离线' } as Partial<
        Record<DataStatus, string>
      >
    )[status] ?? ''
  )
}

/** Keep an independent last successful read, but never repeat the primary timestamp. */
export function additionalSuccess(
  status: DataStatus,
  lastSuccessAt?: string | null,
  primaryAt?: string | null,
) {
  return summaryStatus(status) && lastSuccessAt && lastSuccessAt !== primaryAt
    ? lastSuccessAt
    : null
}
