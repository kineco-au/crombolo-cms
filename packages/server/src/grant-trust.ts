/**
 * Story 335: an extension granted Acts as you or Unrestricted keeps that only
 * while someone this site trusts vouches for it. Checked at every start, before
 * extensions run, so an upgrade switches off what no longer qualifies; and as a
 * signer is taken off Trusted signers, so what it vouched for stops at once.
 */
import { type ExtensionRegistry, isUpperLevel, levelOf } from '@crombolo/backoffice-host/registry'
import type { Db } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import { APPROVED_BY_CODE, type BundleGrants } from './bundle-grants.ts'
import type { CromboloConfig } from './config.ts'
import { signerWords, vouchedFor } from './grant-policy.ts'
import { logger } from './logging.ts'
import { createMarketplace } from './marketplace.ts'
import { signerTrusted } from './site-trust.ts'

/** Who switches them off, as the audit log records it. */
export const SWITCHED_OFF_BY = 'crombolo'

/**
 * Withdraws each upper-level grant recorded here that nobody this site trusts
 * vouches for, so it is granted again only by the rule; the ids withdrawn. A
 * grant the site's code makes is the developer's, and kept.
 */
export async function switchOffUntrusted(
  db: Db,
  config: CromboloConfig,
  extensions: ExtensionRegistry,
  grants: Pick<BundleGrants, 'granted' | 'isOn' | 'state' | 'forget'>,
  /** At start, or because a signer was just taken off the list. */
  when: 'start' | 'untrusted' = 'start',
): Promise<string[]> {
  const marketplace = createMarketplace({
    registry: config.npmRegistry,
    keyword: config.packageKeyword,
    marketplaceUrl: config.marketplaceUrl,
    componentsDir: config.componentsDir,
    extensions,
    siteDir: config.siteDir,
    trustSigner: (provenance) => signerTrusted(db, config, provenance),
  })
  const packages = new Map(extensions.bundles().bundles.map((pkg) => [pkg.id, pkg]))
  const switched: string[] = []
  for (const item of await marketplace.installed()) {
    const pkg = packages.get(item.id)
    if (!pkg || !grants.isOn(item.id)) continue
    if (grants.state(pkg).grant?.grantedBy === APPROVED_BY_CODE) continue
    if (!isUpperLevel(levelOf(grants.granted(item.id)))) continue
    // A signature that can't be checked right now is left alone, not judged.
    if (item.provenance.state === 'unchecked' || vouchedFor(item.provenance)) continue
    await grants.forget(pkg.id)
    const signer = signerWords(item.provenance)
    const why = signer
      ? `signed by ${signer}, which this site doesn't trust`
      : 'nobody has vouched for who built it'
    await recordAudit(db, {
      category: 'system',
      action: 'Disable',
      entityType: 'Bundle',
      entityName: `${pkg.packageName}@${pkg.version}`,
      detail: `switched off ${when === 'start' ? 'at start' : 'as its signer was taken off Trusted signers'}: it acts as you or runs unrestricted, and is ${why}; it needs granting again`,
      source: when === 'start' ? 'boot' : 'request',
      userKey: null,
      userName: SWITCHED_OFF_BY,
      ipAddress: null,
      forwardedFor: null,
    })
    logger('server').warn(
      '{extension} is switched off: it acts as you or runs unrestricted, and is {why}. Trust its signer in Settings → Trusted signers, then grant it again.',
      { extension: pkg.packageName, why },
    )
    switched.push(item.id)
  }
  return switched
}
