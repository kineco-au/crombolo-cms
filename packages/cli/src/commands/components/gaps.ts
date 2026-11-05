import { findGaps } from '@crombolo/server'
import { BaseCommand } from '../../base.ts'
import { gapLine } from '../../support/components.ts'
import { siteConfig } from '../../support/site.ts'

export default class ComponentsGaps extends BaseCommand {
  static override summary = 'the gaps marked in templates, with their reasons'
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    // One item of `items`, as clispec reads a collection.
    outputFields: [
      { name: 'file', type: 'string' },
      { name: 'line', type: 'integer' },
      { name: 'reason', type: 'string', nullable: true },
      { name: 'was', type: 'string', nullable: true },
    ],
  } as const

  async run() {
    await this.parse(ComponentsGaps)
    const config = await siteConfig()
    const items = findGaps(config.componentsDir, config.siteDir)
    if (items.length === 0) this.say('No gaps.')
    for (const gap of items) this.say(gapLine(gap))
    return { items }
  }
}
