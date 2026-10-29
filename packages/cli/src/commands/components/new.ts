import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { blockScaffold, viewScaffold } from '@crombolo/schema'
import {
  componentFileFor,
  componentScaffold,
  EMAIL_FOLDER,
  emailScaffold,
  isSafeAlias,
} from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { declaredTypes, formsNamingEmailTemplate } from '../../support/components.ts'
import { here } from '../../support/describe.ts'
import { siteConfig } from '../../support/site.ts'

export default class ComponentsNew extends BaseCommand {
  static override summary = 'components/<alias>.tsx; the alias may carry folders'
  static override examples = [
    '<%= config.bin %> components new pages/article',
    '<%= config.bin %> components new --block quote',
    '<%= config.bin %> components new --folder pages/my-records',
  ]
  static override args = {
    alias: Args.string({ description: "the component's alias" }),
  }
  static override flags = {
    block: Flags.string({
      summary: "an element type's block component: components/blocks/<alias>.tsx",
      helpValue: '<element alias>',
    }),
    folder: Flags.boolean({
      summary: "components/<alias>/page.tsx, so the page's own parts can sit beside it",
    }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'created', type: 'string' },
      { name: 'template', type: 'boolean' },
      { name: 'email', type: 'boolean' },
      { name: 'block', type: 'boolean' },
    ],
    errors: ['usage', 'conflict'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ComponentsNew)
    const config = await siteConfig()
    if (flags.block !== undefined) return this.#block(flags.block, args.alias, config)
    if (!args.alias) this.fail('usage', 'Name the component, or pass --block <element alias>.')
    const alias = args.alias
    if (!isSafeAlias(args.alias))
      this.fail('usage', `"${args.alias}" is not a path inside ${here(config.componentsDir)}.`)
    const existing = componentFileFor(config.componentsDir, args.alias)
    if (existsSync(existing)) this.fail('conflict', `${here(existing)} already exists.`)
    const file = componentFileFor(config.componentsDir, args.alias, { folder: flags.folder })
    // A content type that names this alias gets the page scaffold, which takes
    // PageProps; one in emails/, or one a form's Send email names, gets the
    // e-mail one, which takes EmailProps; anything else gets the plain one.
    const type = declaredTypes(config).find((candidate) => candidate.components.includes(alias))
    const email =
      !type &&
      (args.alias.startsWith(EMAIL_FOLDER) ||
        formsNamingEmailTemplate(config, args.alias).length > 0)
    if (!type && !email)
      this.say(
        `  note     no content type declares the template "${args.alias}" — add it to one's templates, or \`crombolo types new\``,
      )
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(
      file,
      type ? viewScaffold(type) : email ? emailScaffold(args.alias) : componentScaffold(args.alias),
    )
    this.say(`  created  ${here(file)}`)
    return { created: here(file), template: Boolean(type), email, block: false }
  }

  /** `components/blocks/<alias>.tsx`, for an element type that exists (story 184). */
  async #block(
    alias: string,
    extra: string | undefined,
    config: Awaited<ReturnType<typeof siteConfig>>,
  ) {
    if (extra) this.fail('usage', 'Give either a component alias or --block, not both.')
    const type = declaredTypes(config).find((candidate) => candidate.alias === alias)
    if (!type) this.fail('usage', `There is no element type "${alias}".`)
    if (!type.isElement) this.fail('usage', `"${alias}" is a page type, not an element type.`)
    const file = componentFileFor(config.componentsDir, `blocks/${alias}`)
    if (existsSync(file)) this.fail('conflict', `${here(file)} already exists.`)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, blockScaffold(type))
    this.say(`  created  ${here(file)}`)
    return { created: here(file), template: false, email: false, block: true }
  }
}
