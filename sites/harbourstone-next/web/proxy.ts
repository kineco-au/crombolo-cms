import { cromboloMiddleware } from '@crombolo/next-integration/middleware'
import { crombolo } from './lib/crombolo'

/** Keeps a signed-in member's session fresh before a page reads it. */
export default cromboloMiddleware(crombolo)

export const config = { matcher: ['/((?!_next/|media/|favicon.ico).*)'] }
