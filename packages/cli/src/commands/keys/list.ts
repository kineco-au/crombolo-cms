import { listUserKeys } from '@crombolo/server'
import { BaseCommand } from '../../base.ts'

/** The keys of your own on this machine (story 316). */
export default class KeysList extends BaseCommand {
  static override summary = 'the keys of your own on this machine, with their public lines'
  static override examples = ['<%= config.bin %> keys list']
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'publicKey', type: 'string' },
      { name: 'fingerprint', type: 'string' },
    ],
  } as const

  async run() {
    await this.parse(KeysList)
    const keys = listUserKeys()
    if (keys.length === 0) this.say('No keys here: make one with `crombolo keys create <name>`.')
    for (const key of keys)
      this.say(`  ${key.name}  ${key.publicKey.fingerprint}\n      ${key.publicKey.line}`)
    return keys.map((key) => ({
      name: key.name,
      publicKey: key.publicKey.line,
      fingerprint: key.publicKey.fingerprint,
    }))
  }
}
