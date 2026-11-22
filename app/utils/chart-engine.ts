import { init, use } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

use([BarChart, LineChart, GridComponent, SVGRenderer])

export function createChart(element: HTMLElement) {
  return init(element, undefined, { renderer: 'svg' })
}
