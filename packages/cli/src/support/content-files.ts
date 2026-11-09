/**
 * Writing a site's content out as the files `site apply` reads back (stories
 * 163, 164, 167): pages to content/pages, and with --all every Library element
 * and media item too, in the shorthand a person writes.
 */
import { ObjectTypes } from '@crombolo/core'
import { describeRefFailure, NodeRepository, resolveNodeRef } from '@crombolo/data'
import { bootstrapDatabase, exportSeed, MediaFileStore, mediaStoreFor } from '@crombolo/server'
import { CliError } from '../errors.ts'
import { type Io, siteConfig } from './site.ts'

export async function exportContentFiles(
  io: Io,
  refs: readonly string[],
  all: boolean,
): Promise<{ written: string[] }> {
  if (refs.length === 0 && !all)
    throw new CliError('usage', 'Name the pages to write with --root, or pass --all.')
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    const pages = []
    if (all)
      pages.push(
        ...(
          await new NodeRepository(db).children(
            -1,
            ObjectTypes.Document,
            0,
            Number.MAX_SAFE_INTEGER,
          )
        ).items,
      )
    else
      for (const ref of refs) {
        const resolved = await resolveNodeRef(db, [ObjectTypes.Document], ref)
        if (!resolved.ok) throw new CliError('not_found', describeRefFailure(ref, resolved))
        pages.push(resolved.node)
      }
    const result = await exportSeed(db, config.siteDir, {
      pages,
      library: all,
      media: all,
      files: all ? new MediaFileStore(await mediaStoreFor(config)) : undefined,
    })
    for (const file of result.written) io.say(`  wrote    ${file}`)
    return result
  } finally {
    await db.close()
  }
}
