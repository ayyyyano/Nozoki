import type { Database, D1Statement, D1Result } from '../types/database.ts'
export function meterDatabase(raw: Database) {
  const metrics = { calls: 0, statements: 0, rowsRead: 0, rowsWritten: 0 },
    statements = new WeakMap<D1Statement, D1Statement>()
  function record(r: D1Result) {
    metrics.rowsRead += Number(r.meta.rows_read ?? 0)
    metrics.rowsWritten += Number(r.meta.rows_written ?? 0)
  }
  const db: Database = {
    prepare(sql) {
      const wrap = (stmt: D1Statement): D1Statement => {
        const wrapped: D1Statement = {
          bind(...values) {
            return wrap(stmt.bind(...values))
          },
          async first<T>() {
            metrics.calls++
            metrics.statements++
            return stmt.first<T>()
          },
          async all<T>() {
            metrics.calls++
            metrics.statements++
            const r = await stmt.all<T>()
            record(r as D1Result)
            return r
          },
          async run<T>() {
            metrics.calls++
            metrics.statements++
            const r = await stmt.run<T>()
            record(r as D1Result)
            return r
          },
        }
        statements.set(wrapped, stmt)
        return wrapped
      }
      return wrap(raw.prepare(sql))
    },
    async batch<T>(items: D1Statement[]) {
      metrics.calls++
      metrics.statements += items.length
      const results = await raw.batch<T>(items.map((s) => statements.get(s) ?? s))
      for (const r of results) record(r as D1Result)
      return results
    },
  }
  return { db, metrics }
}
