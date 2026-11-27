/**
 * The flags and fields the workspace commands share (story 386), apart from what
 * reaches a site, so a plugin's command can declare them loading nothing more.
 */
import { Args, Flags } from '@oclif/core'

export const siteFlags = {
  profile: Flags.string({
    summary: 'a hosted site, by its profile, rather than this folder’s',
    helpValue: '<name>',
  }),
  env: Flags.string({
    summary: 'the hosted site’s environment, named whenever --profile is',
    helpValue: '<id>',
  }),
  'include-private': Flags.boolean({
    summary: 'an administrator: read a workspace you are not in, a person’s own included',
  }),
}

export const workspaceArg = Args.string({
  required: true,
  description: 'the workspace, by its name or key, or shared for what the site holds',
})

/** The `where` every command's JSON carries. */
export const whereField = { name: 'where', type: 'string' } as const
