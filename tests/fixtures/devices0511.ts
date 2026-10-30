// Offline synthetic protocol fixture. Never imported by production or seeded into daily D1.
export const devicesNow = new Date('2026-10-27T08:00:00.000Z')
export function sleepyDevicesFixture() {
  const time = devicesNow.getTime() / 1000
  const item = (show_name: string, status: string | null, using: boolean | null = true) => ({
    show_name,
    status,
    using,
    fields: {},
    last_updated: time - 86400,
  })
  return {
    success: true,
    time,
    last_updated: time - 86400,
    status: { id: 0, name: 'Fixture', desc: 'Offline demonstration only' },
    device: {
      laptop: item('演示笔记本', '[🔋66%⚡] Visual Studio Code'),
      zero: item('演示零电量', '[🔋0%] Terminal'),
      full: item('演示满电量', 'Launcher[100%]🔋'),
      desktop: item('演示台式设备', 'No battery · Document 40% complete'),
      idle: item('演示闲置设备', null, false),
      unknown: item('演示未知设备', null, null),
      long: item('演示长窗口标题', '长窗口标题 — '.repeat(150)),
      html: item(
        '演示 HTML 文字',
        '[🔋66%] <img src=x onerror="alert(1)"> & <script>bad()</script>',
      ),
      'private.a/~': item('PRIVATE-DEVICE-0511', '[🔋66%] PRIVATE-APPLICATION-0511'),
    },
  }
}
