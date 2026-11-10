import { BaseCommand } from '../../base.ts'
import { withTrustedSigners } from '../../support/trusted.ts'

const KINDS = { user: 'user key', site: 'site key', source: 'CI build' } as const

/** What this site trusts to sign the site bundles it applies (story 316). */
export default class KeysTrusted extends BaseCommand {
  static override summary =
    'the keys and CI builds this site trusts to sign the site bundles it applies'
  static override examples = ['<%= config.bin %> keys trusted']
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      { name: 'id', type: 'string', nullable: true },
      { name: 'kind', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'fingerprint', type: 'string', nullable: true },
      { name: 'source', type: 'string', nullable: true },
      { name: 'locked', type: 'boolean' },
    ],
  } as const

  async run() {
    await this.parse(KeysTrusted)
    const items = await withTrustedSigners((admin) => admin.list())
    for (const item of items)
      this.say(
        `  ${item.name}  (${KINDS[item.kind]}${item.own ? ', this site' : item.locked ? ', in the config' : ''})  ${item.fingerprint ?? item.source}`,
      )
    return items.map((item) => ({
      id: item.id ?? null,
      kind: item.kind,
      name: item.name,
      fingerprint: item.fingerprint ?? null,
      source: item.source ?? null,
      locked: item.locked,
    }))
  }
}
