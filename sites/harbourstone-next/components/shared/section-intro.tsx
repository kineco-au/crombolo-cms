import type { Child, PublishedContent } from '@crombolo/crombolo'

/** The small letter-spaced line that sits above every heading on this site. */
export function Eyebrow({ children, tone }: { children?: Child; tone?: 'light' }) {
  if (!children) return null
  return <p class={`caps ${tone === 'light' ? 'text-brass' : 'text-brass-deep'}`}>{children}</p>
}

/** The larger, quieter paragraph under a page's title. */
export function Standfirst({ children }: { children?: Child }) {
  return <p class="mt-6 max-w-xl text-lg text-muted">{children}</p>
}

/**
 * The header at the top of a page: eyebrow, title, standfirst. Reads the three
 * properties by the aliases every page type here shares, so a new page type
 * gets the same header by naming its properties the same way.
 */
export function PageHeader({ model }: { model: PublishedContent }) {
  return (
    <header class="page-column pt-16 pb-6 md:pt-24">
      <Eyebrow>{model.text('eyebrow')}</Eyebrow>
      <h1 class="heading-display mt-3 max-w-[20ch] text-5xl leading-none md:text-7xl">
        {model.text('title')}
      </h1>
      {model.hasValue('standfirst') ? <Standfirst>{model.text('standfirst')}</Standfirst> : null}
    </header>
  )
}

/** An eyebrow and a heading, for a section inside a page. */
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
          class={`heading-display mt-3 text-4xl leading-tight md:text-5xl ${tone === 'light' ? 'text-foam' : ''}`}
        >
          {heading}
        </h2>
      ) : null}
    </>
  )
}

/**
 * A rich-text body, as the editor wrote it: Tailwind's typography, set in the
 * site's faces and colours.
 */
export function Prose({ children }: { children?: Child }) {
  return <div class="prose-site mt-5">{children}</div>
}
