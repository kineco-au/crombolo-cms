/**
 * Next.js 16's cache for `createCrombolo` (story 208): `'use cache'`, tagged
 * from each answer with `cacheTag`, so a publish clears exactly what holds the
 * page and its ancestors. Needs `cacheComponents: true` in `next.config.ts`.
 */
import { cacheLife, cacheTag, revalidateTag } from 'next/cache'
import {
  type CacheAdapter,
  type KeptAnswer,
  keptHeaders,
  MISSING_TAG,
  tagOf,
  tagsFor,
  unkept,
} from './cache.ts'

export async function keptAnswer(
  url: string,
  headers: Record<string, string>,
): Promise<KeptAnswer> {
  'use cache'
  const response = await fetch(url, { headers })
  const body = await response.text()
  // Kept for as long as nothing changes; the webhook says when something does.
  if (unkept(response.headers)) cacheLife('seconds')
  else cacheLife('max')
  cacheTag(...tagsFor(response.status, body, response.headers))
  return { status: response.status, body, headers: keptHeaders(response.headers) }
}

export const cache16: CacheAdapter = {
  major: 16,
  answer: keptAnswer,
  revalidate(keys) {
    for (const tag of [MISSING_TAG, ...keys.map(tagOf)]) revalidateTag(tag, 'max')
  },
}
