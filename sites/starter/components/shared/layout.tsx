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
