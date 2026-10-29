import { liveReloadHandler } from '@crombolo/next-integration/route-handlers'
import { crombolo } from '@/lib/crombolo'

/** The CMS's changes, for `<CromboloLiveReload />` in development. */
export const GET = liveReloadHandler(crombolo)
