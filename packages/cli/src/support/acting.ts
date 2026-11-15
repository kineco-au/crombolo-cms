/**
 * Who a command acts as (story 350): the person signed in to the site, whom the
 * gate found before the command ran, or the command line when nobody is and
 * the site lets commands run without a sign-in.
 */
import type { Principal } from '@crombolo/api-management/domain'
import { type Actor, operatorActor, userActor } from '@crombolo/content'
import { CliError } from '../errors.ts'
import { commandActorName } from '../operations/commands.ts'

let person: Principal | undefined

export function actAs(principal: Principal | undefined): void {
  person = principal
}

/** The signed-in person, when there is one. */
export const signedInPerson = (): Principal | undefined => person

/** Whom the audit log names for a command: the signed-in person, by key and name. */
export const signedIn = (): { key: string; name: string } | undefined =>
  person && { key: person.id, name: person.name }

/**
 * The actor a write is made as. `--skip-approval` is an administrator's when
 * someone is signed in, and anyone's at the command line.
 */
export function commandActor(options: { skipApproval?: boolean } = {}): Actor {
  if (!person) return operatorActor(commandActorName(), options)
  if (options.skipApproval && !person.isAdmin)
    throw new CliError('refused', 'Only an administrator can skip approval.', {
      hint: 'Leave out --skip-approval, and the change waits for its approval.',
    })
  return userActor(person, { source: 'cli' }, options)
}
