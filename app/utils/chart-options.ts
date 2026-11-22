import type { ComposeOption } from 'echarts/core'
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts'
import type { GridComponentOption } from 'echarts/components'

export type ChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | GridComponentOption>
export interface ChartPalette {
  primary: string
  text: string
  muted: string
  outline: string
  success: string
  danger: string
  warning: string
  info: string
}
