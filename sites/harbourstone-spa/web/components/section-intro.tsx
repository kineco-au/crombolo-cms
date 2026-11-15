import type { ReactNode } from 'react'
import { type Page, text } from '@/lib/content'

/** The small letter-spaced line that sits above every heading on this site. */
export function Eyebrow({ children, tone }: { children?: ReactNode; tone?: 'light' }) {
  if (!children) return null
  return <p className={tone === 'light' ? 'eyebrow eyebrow--light' : 'eyebrow'}>{children}</p>
}

/** Eyebrow, title, standfirst: read by the aliases every page type here shares. */
export function PageHeader({ page }: { page: Page }) {
  return (
    <header className="page-header">
      <Eyebrow>{text(page, 'eyebrow')}</Eyebrow>
      <h1>{text(page, 'title') || page.name}</h1>
      {text(page, 'standfirst') ? <p className="standfirst">{text(page, 'standfirst')}</p> : null}
    </header>
  )
}

export function SectionIntro({
  eyebrow,
  heading,
  tone,
}: {
  eyebrow: string
  heading: string
  tone?: 'light'
}) {
  return (
    <>
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      {heading ? <h2>{heading}</h2> : null}
    </>
  )
}
