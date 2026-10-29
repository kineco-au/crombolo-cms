/**
 * Next.js 15's cache for `createCrombolo` (story 208). Next 15 tags a fetch
 * before it runs, so the keys an answer holds cannot tag it: every answer is
 * kept under the site's tag, and any change clears them all.
 */
import { revalidateTag } from 'next/cache'
import { type CacheAdapter, keptHeaders, SITE_TAG } from './cache.ts'

export const cache15: CacheAdapter = {
  major: 15,
  async answer(url, headers) {
    const response = await fetch(url, {
      headers,
      next: { tags: [SITE_TAG], revalidate: false },
    } as RequestInit)
    const body = await response.text()
    return { status: response.status, body, headers: keptHeaders(response.headers) }
  },
  revalidate() {
    ;(revalidateTag as (tag: string) => void)(SITE_TAG)
  },
}
