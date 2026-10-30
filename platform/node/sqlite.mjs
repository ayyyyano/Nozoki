import { DatabaseSync, backup } from 'node:sqlite'
import { closeSync, existsSync, mkdirSync, openSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

/** File-backed implementation of server/types/database.ts. Every batch is one transaction. */
export class SqliteDatabase {
  constructor(path) {
    if (!path || !isAbsolute(path) || path === ':memory:')
      throw new Error('NOZOKI_SQLITE_PATH_MUST_BE_ABSOLUTE')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (!existsSync(path)) closeSync(openSync(path, 'ax', 0o600))
    this.path = realpathSync(path)
    this.connection = new DatabaseSync(this.path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      timeout: 1000,
    })
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
  }
  prepare(sql) {
    return new SqliteStatement(this, sql)
  }
  async batch(statements) {
    if (statements.some((s) => !(s instanceof SqliteStatement) || s.database !== this))
      throw new Error('SQLITE_STATEMENT_CONNECTION_MISMATCH')
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map((s) => s.execute())
      this.connection.exec('COMMIT')
      return results
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }
  async backupTo(destination) {
    if (!isAbsolute(destination) || resolve(destination) === this.path)
      throw new Error('BACKUP_PATH_MUST_BE_DISTINCT_AND_ABSOLUTE')
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    // Reserve the destination so an existing backup can never be overwritten.
    closeSync(openSync(destination, 'ax', 0o600))
    await backup(this.connection, destination)
    const check = new DatabaseSync(destination, { readOnly: true })
    try {
      if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
        throw new Error('BACKUP_VALIDATION_FAILED')
    } finally {
      check.close()
    }
  }
  close() {
    this.connection.close()
  }
}

class SqliteStatement {
  constructor(database, sql, values = []) {
    this.database = database
    this.sql = sql
    this.values = values.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v))
  }
  bind(...values) {
    return new SqliteStatement(this.database, this.sql, values)
  }
  execute(run = false) {
    const c = this.database.connection,
      statement = c.prepare(this.sql),
      before = c.prepare('SELECT total_changes() AS n').get().n
    let results = [],
      changes
    if (run || !statement.columns().length) changes = Number(statement.run(...this.values).changes)
    else {
      results = statement.all(...this.values).map((row) => ({ ...row }))
      changes = Number(c.prepare('SELECT total_changes() AS n').get().n - before)
    }
    return { success: true, results, meta: { changes } }
  }
  async all() {
    return this.execute()
  }
  async first() {
    return this.execute().results[0] ?? null
  }
  async run() {
    return this.execute(true)
  }
}
