/**
 * Folder holds the other built-in media types (story 180). Every command and
 * boot opens the database through `installDatabase`, which links Folder here
 * unless a schema file defines Folder and so says itself what it allows. A sync
 * links any type it adds in its own transaction (`syncSchema`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Db, ensureSystemMediaTypes } from '@crombolo/data'

/** Whether a file under `schema/media-types/` defines Folder. */
export function folderDefinedInFiles(schemaDir: string): boolean {
  const dir = join(schemaDir, 'media-types')
  if (!existsSync(dir)) return false
  return readdirSync(dir)
    .filter((name) => name.endsWith('.toml'))
    .some((name) => {
      try {
        const parsed = Bun.TOML.parse(readFileSync(join(dir, name), 'utf8')) as {
          'media-type'?: { alias?: unknown }
        }
        const alias = parsed['media-type']?.alias
        return typeof alias === 'string' && alias.toLowerCase() === 'folder'
      } catch {
        return false
      }
    })
}

export async function linkMediaFolders(db: Db, schemaDir: string): Promise<void> {
  await ensureSystemMediaTypes(db, { linkFolderChildren: !folderDefinedInFiles(schemaDir) })
}
