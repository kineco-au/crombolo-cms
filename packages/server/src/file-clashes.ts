/**
 * The published Files something above them answers in place of (story 450),
 * read from the site's database by a command that runs no server, as
 * `crombolo components check` does. Nothing when there is no database to read.
 */
import { existsSync } from 'node:fs'
import { connect, type Db } from '@crombolo/data'
import { PublishedCache } from '@crombolo/render'
import { createPublishedContentSource } from './adapters/documents.ts'
import type { CromboloConfig } from './config.ts'
import { type UnansweredFile, unansweredFiles } from './file-items.ts'
import { publicPaths } from './site-public.ts'

export async function fileClashes(
  config: Pick<CromboloConfig, 'dialect' | 'sqliteFile' | 'publicDir' | 'backOfficePath'>,
): Promise<UnansweredFile[] | undefined> {
  if (
    config.dialect === 'sqlite' &&
    config.sqliteFile !== ':memory:' &&
    !existsSync(config.sqliteFile)
  )
    return undefined
  let db: Db
  try {
    db = await connect({ dialect: config.dialect, file: config.sqliteFile, readOnly: true })
  } catch {
    return undefined
  }
  try {
    const cache = new PublishedCache(createPublishedContentSource(db))
    const paths = new Set(publicPaths(config.publicDir, config.backOfficePath))
    return unansweredFiles(await cache.files(), {
      backOfficePath: config.backOfficePath,
      isPublic: (path) => paths.has(path),
    })
  } catch {
    return undefined
  } finally {
    await db.close()
  }
}
