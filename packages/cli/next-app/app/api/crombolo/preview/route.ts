import { previewHandler } from '@crombolo/next-integration/route-handlers'
import { crombolo } from '@/lib/crombolo'

/** Where the CMS's Preview button sends an editor. */
export const GET = previewHandler(crombolo)
