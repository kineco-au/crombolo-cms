/** @jsxImportSource react */
'use client'
/**
 * The browser half of `<RichText>` (story 208): a click on a link to a page of
 * this site navigates with Next's router rather than reloading the page.
 */
import { useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'

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
