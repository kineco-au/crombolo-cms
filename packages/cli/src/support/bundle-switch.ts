/** `bundle disable` and `bundle enable` (stories 225, 241): one command, either way. */
import { Args } from '@oclif/core'
import { CliError } from '../errors.ts'
import { hostedOrHere, type ProfileFlagValues } from '../profiles/choose.ts'
import { cliActor, remoteBundles, withLocalBundles } from './bundles.ts'
import { profileFlags } from './remote.ts'
import type { Io } from './site.ts'

export const switchArgs = {
  name: Args.string({ required: true, description: 'the bundle id or its package name' }),
}

export const switchFlags = profileFlags

export const switchSpec = {
  effects: 'idempotent',
  cardinality: 'single',
  outputFields: [
    { name: 'name', type: 'string' },
    { name: 'on', type: 'boolean' },
    { name: 'remote', type: 'string', nullable: true },
  ],
  errors: ['not_found', 'auth', 'refused', 'unavailable'],
} as const

export async function switchBundle(
  io: Io,
  name: string,
  flags: ProfileFlagValues,
  enabled: boolean,
) {
  const site = hostedOrHere(flags)
  const outcome = site
    ? await (await remoteBundles(site)).setEnabled(name, enabled)
    : await withLocalBundles((admin) => admin.setEnabled(cliActor(), name, enabled))
  if (!outcome.ok) throw new CliError('not_found', outcome.message)
  io.say(`  ${outcome.message}`)
  return { name, on: outcome.on ?? enabled, remote: site?.name ?? null }
}
