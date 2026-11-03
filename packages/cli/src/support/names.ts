/**
 * Permissions, sections and webhook events by the names a person types (story
 * 254), turned into what a group or webhook stores; an unknown one is refused
 * with the names allowed.
 */
import { WEBHOOK_EVENTS } from '@crombolo/api-management'
import {
  eventName,
  isExtensionSectionAlias,
  permissionName,
  permissionVerb,
  SECTION_ALIASES,
} from '@crombolo/core'
import { CliError } from '../errors.ts'

/** The stored verbs for permissions given by plain name or verb. */
export function permissionVerbs(given: readonly string[] | undefined): string[] | undefined {
  return given?.map((name) => {
    const found = permissionVerb(name)
    if (found.ok) return found.verb
    throw new CliError('refused', `${found.reason}.`, {
      hint: '`crombolo users groups permissions` lists them, with what each allows.',
    })
  })
}

const SECTION_BY_MANIFEST = new Map(
  Object.entries(SECTION_ALIASES).map(([name, manifest]) => [manifest.toLowerCase(), name]),
)

/** The stored sections for sections given by name, or by an extension's section alias. */
export function sectionNames(given: readonly string[] | undefined): string[] | undefined {
  return given?.map((name) => {
    const wanted = name.trim().toLowerCase()
    if (wanted in SECTION_ALIASES) return wanted
    const named = SECTION_BY_MANIFEST.get(wanted)
    if (named) return named
    if (isExtensionSectionAlias(name)) return name
    throw new CliError(
      'refused',
      `"${name}" is not a section: one of ${Object.keys(SECTION_ALIASES).join(', ')}.`,
      { hint: '`crombolo users groups sections` says what each opens.' },
    )
  })
}

/** Each event with its plain name, as `webhooks events` lists them. */
export const EVENTS = WEBHOOK_EVENTS.map((event) => ({
  name: eventName(event.eventName),
  alias: event.alias,
  says: event.eventName,
  kind: event.eventType,
}))

/** The stored event aliases for events given by plain name or alias. */
export function eventAliases(given: readonly string[] | undefined): string[] | undefined {
  return given?.map((name) => {
    const wanted = name.trim().toLowerCase()
    const found = EVENTS.find((e) => e.name === wanted || e.alias.toLowerCase() === wanted)
    if (found) return found.alias
    throw new CliError(
      'refused',
      `"${name}" is not an event: one of ${EVENTS.map((e) => e.name).join(', ')}.`,
      { hint: '`crombolo webhooks events` says what raises each.' },
    )
  })
}

/** An event alias's plain name, or the alias when it has none. */
export const eventNameOf = (alias: string): string =>
  EVENTS.find((e) => e.alias === alias)?.name ?? alias

export { permissionName }
