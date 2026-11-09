/**
 * A command that has moved (story 306): it says where, and does nothing. Site
 * packages went to `crombolo site`, leaving `crombolo bundle` to extensions.
 */
import { BaseCommand } from '../base.ts'

/** A command class for `from`, which names `to` and changes nothing, whatever it is given. */
export function movedCommand(from: string, to: string) {
  return class Moved extends BaseCommand {
    static override summary = `moved: use \`crombolo ${to}\``
    static override hidden = true
    static override strict = false
    static override spec = {
      effects: 'read_only',
      cardinality: 'single',
      outputFields: [],
      errors: ['usage'],
    } as const

    async run() {
      this.changedNothing = true
      this.fail('usage', `\`crombolo ${from}\` is now \`crombolo ${to}\`.`)
    }
  }
}
