const channelName = 'nozoki-dashboard-updates'

export function useDashboardSync(reload: () => Promise<void>) {
  const route = useRoute()
  let channel: BroadcastChannel | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const refreshVisible = () => {
    if (document.visibilityState === 'visible') void reload()
  }
  onMounted(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(channelName)
        channel.onmessage = (event) => {
          if (event.data === 'config-saved') refreshVisible()
        }
      } catch {
        // Restricted browser contexts still refresh on focus and the normal polling interval.
      }
    }
    timer = setInterval(() => {
      if (route.path === '/') refreshVisible()
    }, 30000)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    channel?.close()
    window.removeEventListener('focus', refreshVisible)
    document.removeEventListener('visibilitychange', refreshVisible)
  })
  provide('notifyDashboardSaved', () => channel?.postMessage('config-saved'))
}
