/**
 * Rollback is a backup (docs/packaging-and-upgrades.md): SQLite is copied
 * beside the database; Postgres runs the operator's `CROMBOLO_PG_DUMP` command
 * or refuses unless the caller vouches with `--backup-taken`.
 */
import { copyFileSync, existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { ownerFile } from '@crombolo/data'
import type { CromboloConfig } from './config.ts'

export interface BackupOptions {
  /** The operator has taken a Postgres backup themselves. */
  backupTaken?: boolean
  /** What the backup is for; goes into the file name. */
  reason: string
}

export interface BackupResult {
  kind: 'sqlite-copy' | 'pg-dump' | 'operator' | 'none'
  path?: string
  /** SQLite: the copies of the site's and bundles' own tables' files beside it (story 189). */
  owners?: string[]
}

/** The site's and bundles' own SQLite files beside crombolo's, whatever is wired now. */
export function ownerFilesBeside(sqliteFile: string): string[] {
  if (sqliteFile === ':memory:') return []
  const site = ownerFile(sqliteFile, 'site')
  const bundle = basename(ownerFile(sqliteFile, 'x')).replace(/x\.sqlite$/, '')
  const dir = dirname(sqliteFile)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(
      (name) => name === basename(site) || (name.startsWith(bundle) && name.endsWith('.sqlite')),
    )
    .map((name) => join(dir, name))
    .sort()
}

export class BackupRequiredError extends Error {
  constructor() {
    super(
      'Postgres needs a backup before this writes: set CROMBOLO_PG_DUMP to a command that takes one, or pass --backup-taken.',
    )
  }
}

export async function backupBefore(
  config: CromboloConfig,
  options: BackupOptions,
): Promise<BackupResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if (config.dialect === 'sqlite') {
    if (config.sqliteFile === ':memory:' || !existsSync(config.sqliteFile)) return { kind: 'none' }
    const path = `${config.sqliteFile}.${stamp}.${options.reason}.bak`
    copyFileSync(config.sqliteFile, path)
    const owners = ownerFilesBeside(config.sqliteFile).map((file) => {
      const copy = `${file}.${stamp}.${options.reason}.bak`
      copyFileSync(file, copy)
      return copy
    })
    return { kind: 'sqlite-copy', path, ...(owners.length > 0 ? { owners } : {}) }
  }
  if (config.pgDump) {
    const proc = Bun.spawn(['sh', '-c', config.pgDump], {
      env: { ...process.env, CROMBOLO_BACKUP_STAMP: stamp, CROMBOLO_BACKUP_REASON: options.reason },
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const code = await proc.exited
    if (code !== 0) throw new Error(`CROMBOLO_PG_DUMP exited with ${code}; not continuing.`)
    return { kind: 'pg-dump' }
  }
  if (options.backupTaken) return { kind: 'operator' }
  throw new BackupRequiredError()
}
