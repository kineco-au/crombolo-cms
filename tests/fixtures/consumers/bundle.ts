/** A third-party server bundle, written against `@crombolo/crombolo/bundle` only (story 173). */
import type { ServerBundle } from '@crombolo/crombolo/bundle'

export const GREETINGS_ID = 'greetings'

export function greetings(): ServerBundle<'log'> {
  return {
    id: GREETINGS_ID,
    section: 'settings',
    capabilities: ['log'],
    routes: [
      {
        method: 'GET',
        path: 'hello',
        handler({ principal, host }) {
          host.log.info('said hello')
          return Response.json({ hello: principal.name })
        },
      },
    ],
  }
}
