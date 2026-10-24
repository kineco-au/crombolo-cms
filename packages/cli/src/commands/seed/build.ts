import { relative, resolve } from 'node:path'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { buildSeed, refuseFindings, writeSeedPackage } from '../../support/seed.ts'

export default class SeedBuild extends BaseCommand {
  static override summary = 'compile seed/ into a bundle, without applying it'
  static override description =
    'The bundle `crombolo content import` reads, for a site or a pipeline that applies it later.'
  static override flags = {
    out: Flags.string({
      required: true,
      summary: 'the directory to write it to',
      helpValue: '<dir>',
    }),
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'id', type: 'string' },
      { name: 'out', type: 'string' },
      { name: 'nodes', type: 'integer' },
    ],
    errors: ['refused'],
  } as const

  async run() {
    const { flags } = await this.parse(SeedBuild)
    const build = await buildSeed()
    refuseFindings(build)
    const out = resolve(flags.out)
    writeSeedPackage(build, out)
    const id = build.set?.manifest.id ?? ''
    const nodes = build.set?.nodes.length ?? 0
    this.say(`  wrote    ${relative(process.cwd(), out) || '.'}  (${nodes} node(s), seed ${id})`)
    return { id, out, nodes }
  }
}
