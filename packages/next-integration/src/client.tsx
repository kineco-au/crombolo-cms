/** @jsxImportSource react */
'use client'
/**
 * The browser half of `<RichText>` (story 208): a click on a link to a page of
 * this site navigates with Next's router rather than reloading the page. And
 * `<CromboloLiveReload />` (story 214), which refreshes the page when the CMS's
 * content or schema changes in development.
 */
import { useRouter } from 'next/navigation'
import { type MouseEvent, type ReactNode, useEffect } from 'react'

export function RichTextLinks({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const router = useRouter()
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = (event.target as HTMLElement).closest('a')
    const href = link?.getAttribute('href')
    if (!link || !href || link.target || link.hasAttribute('download')) return
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/media/')) return
    event.preventDefault()
    router.push(href)
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it catches clicks on the links inside.
    // biome-ignore lint/a11y/useKeyWithClickEvents: links inside keep their own keyboard behaviour.
    <div className={className} onClick={onClick}>
      {children}
    </div>
  )
}

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
