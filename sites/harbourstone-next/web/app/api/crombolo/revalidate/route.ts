import { revalidateHandler } from '@crombolo/next-integration/route-handlers'
import { crombolo } from '@/lib/crombolo'

/** The CMS's webhook, `schema/webhooks/next-revalidate.toml`, posts here on every change. */
export const POST = revalidateHandler(crombolo)
