import type { ReactNode } from 'react'
import { type Page, text } from '@/lib/content'

/** The small letter-spaced line that sits above every heading on this site. */
export function Eyebrow({ children, tone }: { children?: ReactNode; tone?: 'light' }) {
  if (!children) return null
  return <p className={`caps ${tone === 'light' ? 'text-brass' : 'text-brass-deep'}`}>{children}</p>
}

/** The larger, quieter paragraph under a page's title. */
export function Standfirst({ children }: { children?: ReactNode }) {
  return <p className="mt-6 max-w-xl text-lg text-pretty text-muted">{children}</p>
}

/** The title at the top of a page. */
export function PageTitle({ children }: { children?: ReactNode }) {
  return (
    <h1 className="heading-display mt-3 max-w-[20ch] text-5xl leading-none md:text-7xl">
      {children}
    </h1>
  )
}

/** Eyebrow, title, standfirst: read by the aliases every page type here shares. */
export function PageHeader({ page }: { page: Page }) {
  return (
    <header className="page-column pt-16 pb-6 md:pt-24">
      <Eyebrow>{text(page, 'eyebrow')}</Eyebrow>
      <PageTitle>{text(page, 'title') || page.name}</PageTitle>
      {text(page, 'standfirst') ? <Standfirst>{text(page, 'standfirst')}</Standfirst> : null}
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
      {heading ? (
        <h2
          className={`heading-display mt-3 text-4xl leading-tight md:text-5xl ${tone === 'light' ? 'text-foam' : ''}`}
        >
          {heading}
        </h2>
      ) : null}
    </>
  )
}
