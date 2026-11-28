import type { Child, PageProps } from '@crombolo/crombolo'
import { SeoHead } from '@crombolo/crombolo'
import { SiteFooter } from './site-footer.tsx'
import { SiteHeader } from './site-header.tsx'

/** The shell every page shares: head tags, the header, the page, the footer. */
export function Layout(props: PageProps & { children?: Child }) {
  const { model, nav, seo, menu, children } = props
  const siteName = seo.siteName || nav.root()[0]?.name || ''
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <SeoHead {...props} title={model.text('title') || model.name} />
      </head>
      <body class="flex min-h-screen flex-col bg-white text-ink antialiased">
        <SiteHeader model={model} nav={nav} links={menu('main')} siteName={siteName} />
        <main class="mx-auto w-full max-w-6xl flex-1 px-5 pt-10 pb-16">{children}</main>
        <SiteFooter siteName={siteName} />
      </body>
    </html>
  )
}

/** A page's title. */
export const heading = 'mb-4 text-3xl/tight font-bold tracking-tight sm:text-4xl/tight'

/** Rich text from the editor: Tailwind's typography, in the site's colours. */
export const prose =
  'prose max-w-none [--tw-prose-body:var(--color-ink)] [--tw-prose-headings:var(--color-ink)] [--tw-prose-lead:var(--color-muted)] [--tw-prose-links:var(--color-accent)] [--tw-prose-bold:var(--color-ink)] [--tw-prose-counters:var(--color-muted)] [--tw-prose-bullets:var(--color-muted)] [--tw-prose-hr:var(--color-line)] [--tw-prose-quote-borders:var(--color-line)] [--tw-prose-captions:var(--color-muted)] [--tw-prose-th-borders:var(--color-line)] [--tw-prose-td-borders:var(--color-line)]'
