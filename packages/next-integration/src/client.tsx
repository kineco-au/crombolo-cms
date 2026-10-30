/** @jsxImportSource react */
'use client'
/**
 * `<CromboloLiveReload />` (story 214), which refreshes the page when the CMS's
 * content or schema changes in development.
 */
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * In development, refreshes the page's server components when the CMS's
 * content or schema changes, or once this app has revalidated what a webhook
 * named, keeping client state. Renders nothing; does nothing in production.
 * Listens on the route `liveReloadHandler` answers.
 */
export function CromboloLiveReload({ path = '/api/crombolo/live' }: { path?: string }) {
  const router = useRouter()
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const events = new EventSource(path)
    let boot: string | undefined
    events.addEventListener('hello', (event) => {
      const id = (JSON.parse((event as MessageEvent).data) as { boot: string }).boot
      if (boot !== undefined && boot !== id) router.refresh()
      boot = id
    })
    events.addEventListener('reload', (event) => {
      const { reasons } = JSON.parse((event as MessageEvent).data) as { reasons?: string[] }
      if (reasons?.some((reason) => reason === 'content' || reason === 'schema')) router.refresh()
    })
    events.addEventListener('revalidated', () => router.refresh())
    return () => events.close()
  }, [path, router])
  return null
}
