import { mediaHandler } from '@crombolo/next-integration/route-handlers'
import { crombolo } from '@/lib/crombolo'

/** The CMS's media, with a signed-in member's token so protected files reach them. */
export const GET = mediaHandler(crombolo)
