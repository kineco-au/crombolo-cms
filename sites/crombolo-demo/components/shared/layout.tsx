import { asset, type Child, type PageProps, SeoHead } from '@crombolo/crombolo'
import { LanguageSwitch } from './language-switch.tsx'
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
        <link rel="stylesheet" href={asset('/css/site.css')} />
      </head>
      <body>
        <header class="site-header">
          <div class="wrap site-header__inner">
            <a class="wordmark" href={home?.url}>
              {siteName}
            </a>
            <nav aria-label={dictionary('nav.primary')}>
              {menu('main').map((link) => (
                <a
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
              <search>
                <form class="site-search" action={search.url} method="get">
                  <input
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
        <main>{children}</main>
        <SiteFooter siteName={siteName} />
      </body>
    </html>
  )
}
