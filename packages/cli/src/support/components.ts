/** The content types and forms a site declares, which say which components are templates. */
import { existsSync } from 'node:fs'
import type { ComponentGap, CromboloConfig, PublicClash } from '@crombolo/server'
import { loadTypes } from './types.ts'

export const declaredTypes = (config: CromboloConfig) =>
  existsSync(config.schemaDir) ? loadTypes(config).set.contentTypes : []

/** The forms whose Send email workflow names `alias` as its e-mail template. */
export const formsNamingEmailTemplate = (config: CromboloConfig, alias: string) =>
  existsSync(config.schemaDir)
    ? (loadTypes(config).set.forms ?? []).filter((form) =>
        form.workflows.some(
          (workflow) => workflow.type === 'sendEmail' && workflow.settings.template === alias,
        ),
      )
    : []

const PUBLIC_CLASHES: Record<PublicClash['kind'], (clash: PublicClash) => string> = {
  reserved: (clash) => `[warn]   public/${clash.file} never answers: ${clash.address} is the CMS's`,
  route: (clash) => `[warn]   public/${clash.file} takes ${clash.address} from a route`,
  generated: (clash) =>
    `[note]   public/${clash.file} replaces the ${clash.address} the CMS writes`,
}

/** One public file at an address something else answers, as a line of output. */
export const publicClashLine = (clash: PublicClash) => `  ${PUBLIC_CLASHES[clash.kind](clash)}`

/** One gap, as a line of output. */
export const gapLine = (gap: ComponentGap) =>
  `  [gap]    ${gap.file}:${gap.line}  ${gap.reason ?? '(set in code)'}${gap.was ? ` (was: ${gap.was})` : ''}`
