/** A third-party server bundle, written against `@crombolo/crombolo/bundle` only (story 173). */
import { type BundleRouteContext, route, type ServerBundle } from '@crombolo/crombolo/bundle'

export const GREETINGS_ID = 'greetings'

export function greetings(): ServerBundle<'log'> {
  return {
    id: GREETINGS_ID,
    section: 'settings',
    capabilities: ['log'],
    routes: [
      route<unknown, unknown, BundleRouteContext<'log'>>(
        'hello',
        {
          GET(_request, { principal, bundle }) {
            bundle.log.info('said hello')
            return Response.json({ hello: principal?.name })
          },
        },
        { audience: 'backoffice' },
      ),
    ],
  }
}
