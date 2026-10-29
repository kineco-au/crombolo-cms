import { createCrombolo } from '@crombolo/next-integration'
import { cache16 } from '@crombolo/next-integration/cache-16'

/** The CMS, as every page and route handler reads it. */
export const crombolo = createCrombolo({
  url: process.env.CROMBOLO_URL ?? 'http://localhost:8080',
  apiKey: process.env.CROMBOLO_DELIVERY_API_KEY,
  cache: cache16,
  host: process.env.CROMBOLO_HOST,
})
