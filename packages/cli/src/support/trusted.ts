/** This site's trusted signers, for the `keys` commands (story 316): its database, opened and closed. */
import {
  bootstrapDatabase,
  createTrustedSignersAdmin,
  type SignerActor,
  type TrustedSignersAdmin,
} from '@crombolo/server'
import { siteConfig } from './site.ts'

/** Runs `work` with this site's trusted signers, as a person at its CLI. */
export async function withTrustedSigners<T>(
  work: (admin: TrustedSignersAdmin, actor: SignerActor) => Promise<T>,
): Promise<T> {
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    return await work(createTrustedSignersAdmin(db, config), {
      id: null,
      name: process.env.USER ?? 'the CLI',
      email: null,
      source: 'cli',
    })
  } finally {
    await db.close()
  }
}
