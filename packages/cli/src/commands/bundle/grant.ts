import { userInfo } from 'node:os'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import * as ops from '../../operations/commands.ts'
import { siteConfig } from '../../support/site.ts'

/**
 * Approves everything a bundle asks to do with the site, as an operator of this
 * environment (story 222): what the back office's Grant does, for a pipeline
 * or a fresh environment. A bundle is off until it is granted.
 */
export default class BundleGrant extends BaseCommand {
  static override summary = 'approve what a bundle asks to do with the site, turning it on'
  static override description =
    "Grants the whole of what the bundle's package asks for, on this environment's database. A new version that asks for more is off again until it is granted."
  static override args = { id: Args.string({ required: true, description: "the bundle's id" }) }
  static override audit = { category: 'system', action: 'Grant', entityType: 'Bundle' } as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'id', type: 'string' },
      { name: 'package', type: 'string' },
      { name: 'permissions', type: 'array', items: { type: 'string' } },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['refused'],
  } as const

  async run() {
    const { args } = await this.parse(BundleGrant)
    this.auditKey = args.id
    const config = await siteConfig()
    const granted = await ops.bundleGrant(config, args.id, { by: `${userInfo().username} (cli)` })
    this.say(`  ${granted.packageName}@${granted.version} is turned on, granted:`)
    if (granted.permissions.length === 0) this.say('    nothing: it asks for no permissions')
    for (const permission of granted.permissions) this.say(`    ${permission}`)
    return {
      id: granted.id,
      package: `${granted.packageName}@${granted.version}`,
      permissions: granted.permissions,
      changed: true,
    }
  }
}
