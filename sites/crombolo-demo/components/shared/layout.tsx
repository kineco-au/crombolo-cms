import { type Child, type PageProps, SeoHead } from '@crombolo/crombolo'
import { LanguageSwitch } from './language-switch.tsx'
import { Logo } from './logo.tsx'
import { SiteBanner } from './site-banner.tsx'
import { SiteFooter } from './site-footer.tsx'

/** The shell every page shares: head tags, the header, the page, the footer. */
export function Layout(props: PageProps & { children?: Child }) {
  const { model, nav, seo, menu, culture, dictionary, children } = props
  const home = nav.root()[0]
  const siteName = seo.siteName || home?.name || ''
  const search = home && nav.children(home).find((page) => page.contentType.alias === 'searchPage')
  const ancestry = model.path.split(',')
  return (
    <html lang={culture ?? 'en-US'}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <SeoHead
          {...props}
          title={model.text('title') || model.name}
          description={model.text('excerpt') || model.text('summary') || model.text('intro')}
        />
      </head>
      <body class="flex min-h-screen flex-col bg-paper font-sans text-base/7 text-ink antialiased">
        <SiteBanner />
        <header class="border-b border-line">
          <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-5 px-5 py-3 lg:flex-nowrap">
            <a
              class="flex flex-none items-center gap-2 font-serif text-xl font-bold sm:text-2xl text-ink no-underline"
              href={home?.url}
            >
              <Logo />
              {siteName}
            </a>
            <nav
              class="order-1 flex basis-full flex-wrap gap-x-4 gap-y-1 lg:order-none lg:min-w-0 lg:shrink lg:basis-auto lg:flex-nowrap lg:overflow-x-auto lg:whitespace-nowrap"
              aria-label={dictionary('nav.primary')}
            >
              {menu('main').map((link) => (
                <a
                  class="text-ink no-underline hover:text-terracotta aria-[current=page]:font-semibold aria-[current=page]:text-terracotta"
                  href={link.url ?? undefined}
                  aria-current={
                    link.content && ancestry.includes(String(link.content.id)) ? 'page' : undefined
                  }
                >
                  {link.label}
                </a>
              ))}
            </nav>
            {search ? (
              <search class="ms-auto flex-none">
                <form action={search.url} method="get">
                  <input
                    class="w-28 rounded border border-line bg-white px-2.5 py-1.5 text-sm placeholder:text-muted focus:border-green focus:outline-none sm:w-40"
                    type="search"
                    name="q"
                    placeholder={dictionary('search.placeholder')}
                    aria-label={dictionary('search.placeholder')}
                  />
                </form>
              </search>
            ) : null}
            <LanguageSwitch {...props} />
          </div>
        </header>
        <main class="flex-1 pb-16">{children}</main>
        <SiteFooter siteName={siteName} />
      </body>
    </html>
  )
}
