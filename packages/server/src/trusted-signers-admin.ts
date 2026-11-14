/**
 * Trusted signers, as an administrator manages them (story 316): the keys and
 * CI sources this site trusts to sign the site bundles it applies, added,
 * renamed and removed, each change audited. What the config lists, and this
 * site's own key, are shown and never removed here. Settings, the CLI and the
 * back-office endpoint share it.
 */
import { createExtensionRegistry, type ExtensionRegistry } from '@crombolo/backoffice-host/registry'
import { type Db, TrustedSignerRepository } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import { type BundleGrants, createBundleGrants } from './bundle-grants.ts'
import type { CromboloConfig } from './config.ts'
import { switchOffUntrusted } from './grant-trust.ts'
import { readPublicKey } from './signing-keys.ts'
import { type TrustEntry, trustedSigners } from './site-trust.ts'

/** Who changed the list, for the audit log. */
export interface SignerActor {
  id: string | null
  name: string
  email: string | null
  source: 'request' | 'cli'
  ipAddress?: string | null
}

export type SignerOutcome =
  | {
      ok: true
      entry?: TrustEntry
      /** Extensions switched off as their signer was removed, by name (story 335). */
      switchedOff?: string[]
    }
  | { ok: false; status: number; message: string }

/** What removing a signer re-checks: the server's own, or this site's, read here. */
export interface SignerChecks {
  extensions: ExtensionRegistry
  grants: Pick<BundleGrants, 'granted' | 'isOn' | 'state' | 'forget'>
}

/** `org/repo`, `org/*`, or either `@` a ref pattern such as `v*`. */
const SOURCE = /^[A-Za-z0-9_.-]+\/(\*|[A-Za-z0-9_.-]+)(@[A-Za-z0-9_.*/-]+)?$/

export function createTrustedSignersAdmin(
  db: Db,
  config: CromboloConfig,
  options: { checks?: SignerChecks } = {},
) {
  const repo = new TrustedSignerRepository(db)
  /** The running server's registry and grants, or this site's, read from its files and database. */
  const checks = async (): Promise<SignerChecks> => {
    if (options.checks) return options.checks
    const extensions = createExtensionRegistry(config.siteDir, { cache: false })
    const grants = createBundleGrants({
      db,
      packages: () => new Map(extensions.bundles().bundles.map((pkg) => [pkg.id, pkg])),
    })
    await grants.refresh()
    return { extensions, grants }
  }
  const audit = (actor: SignerActor, action: string, name: string, detail: string | null) =>
    recordAudit(db, {
      category: 'system',
      action,
      entityType: 'Trusted signer',
      entityName: name,
      detail,
      source: actor.source,
      userKey: actor.id,
      userName: actor.name,
      ipAddress: actor.ipAddress ?? null,
      forwardedFor: null,
    })
  const stored = async (id: string) => (await repo.all()).find((row) => row.id === id)

  return {
    list: () => trustedSigners(db, config),

    async add(
      actor: SignerActor,
      input: { name?: unknown; kind?: unknown; publicKey?: unknown; source?: unknown },
    ): Promise<SignerOutcome> {
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (!name) return { ok: false, status: 400, message: 'Give it a name you will recognise.' }
      if (name.length > 255) return { ok: false, status: 400, message: 'That name is too long.' }
      const listed = await trustedSigners(db, config)
      if (input.kind === 'source') {
        const source = typeof input.source === 'string' ? input.source.trim() : ''
        if (!SOURCE.test(source))
          return {
            ok: false,
            status: 400,
            message:
              'A build is named as owner/repository, owner/*, or either @ a tag pattern such as v*.',
          }
        if (listed.some((entry) => entry.source === source))
          return { ok: false, status: 409, message: 'That build is already trusted.' }
        const row = await repo.add({
          kind: 'source',
          name,
          publicKey: null,
          fingerprint: null,
          source,
          addedBy: actor.email ?? actor.name,
        })
        await audit(actor, 'Trust', name, `builds of ${source}`)
        return { ok: true, entry: (await trustedSigners(db, config)).find((e) => e.id === row.id) }
      }
      const kind = input.kind === 'site' ? 'site' : 'user'
      const key = readPublicKey(typeof input.publicKey === 'string' ? input.publicKey : '')
      if ('problem' in key) return { ok: false, status: 400, message: key.problem }
      if (listed.some((entry) => entry.fingerprint === key.fingerprint))
        return { ok: false, status: 409, message: 'That key is already trusted.' }
      const row = await repo.add({
        kind,
        name,
        publicKey: key.line,
        fingerprint: key.fingerprint,
        source: null,
        addedBy: actor.email ?? actor.name,
      })
      await audit(actor, 'Trust', name, `${kind} key ${key.fingerprint}`)
      return { ok: true, entry: (await trustedSigners(db, config)).find((e) => e.id === row.id) }
    },

    async rename(actor: SignerActor, id: string, name: unknown): Promise<SignerOutcome> {
      const given = typeof name === 'string' ? name.trim() : ''
      if (!given) return { ok: false, status: 400, message: 'Give it a name you will recognise.' }
      const found = await stored(id)
      if (!found)
        return {
          ok: false,
          status: 404,
          message: 'That one is not on the list, or is set in the site’s configuration.',
        }
      await repo.rename(id, given)
      await audit(actor, 'Rename', given, `was ${found.name}`)
      return { ok: true }
    },

    async remove(actor: SignerActor, id: string): Promise<SignerOutcome> {
      const found = await stored(id)
      if (!found)
        return {
          ok: false,
          status: 404,
          message: 'That one is not on the list, or is set in the site’s configuration.',
        }
      await repo.remove(id)
      await audit(
        actor,
        'Untrust',
        found.name,
        found.fingerprint ? `${found.kind} key ${found.fingerprint}` : `builds of ${found.source}`,
      )
      // Story 335: what it vouched for loses its upper level now, not at the next start.
      const { extensions, grants } = await checks()
      const ids = await switchOffUntrusted(db, config, extensions, grants, 'untrusted')
      const names = new Map(extensions.bundles().bundles.map((pkg) => [pkg.id, pkg.name]))
      return { ok: true, switchedOff: ids.map((id) => names.get(id) ?? id) }
    },
  }
}

export type TrustedSignersAdmin = ReturnType<typeof createTrustedSignersAdmin>
