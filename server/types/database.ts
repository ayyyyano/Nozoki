/** Structural subset of the installed Wrangler/workerd D1 binding, not an in-memory substitute. */
export type D1Value = string | number | null | ArrayBuffer | Uint8Array
export interface D1Result<T = Record<string, unknown>> {
  success: boolean
  results: T[]
  meta: { changes: number; [key: string]: unknown }
}
export interface D1Statement {
  bind(...values: D1Value[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
}
export interface Database {
  prepare(sql: string): D1Statement
  batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1Result<T>[]>
}
export class DataLayerError extends Error {
  code:
    'DB_BINDING_MISSING' | 'CONFIG_NOT_INITIALIZED' | 'CONFIG_BASELINE_INVALID' | 'DATABASE_ERROR'
  constructor(code: DataLayerError['code']) {
    super(code)
    this.code = code
  }
}
