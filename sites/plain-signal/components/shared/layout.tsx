import { type Child, type Navigation, type PublishedContent, usePage } from '@crombolo/crombolo'

/**
 * The shell every page shares: the masthead, the sections, and the footer from
 * the site's settings page (story 058). The face is Newsreader for headlines
 * and Inter for the rest, from Google Fonts; `site.css` names fallbacks, so a
 * blocked request degrades to the system serif and sans.
 */
export function Layout({
  model,
  nav,
  children,
}: {
  model: PublishedContent
  nav: Navigation
  children?: Child
}) {
  const { settings } = usePage()
  const home = nav.root()[0]
  const masthead = home?.text('title') || 'Plain Signal'
  const heading = model.text('title') || model.name
  const sections = home ? nav.children(home) : []
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{home && home.key !== model.key ? `${heading} — ${masthead}` : masthead}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,700&family=Inter:wght@400;500;600&display=swap"
        />
        <link rel="stylesheet" href="/css/site.css" />
      </head>
      <body>
        <header class="masthead">
          <div class="masthead__inner">
            <a class="masthead__name" href={home?.url ?? '/'}>
              {masthead}
            </a>
            <p class="masthead__tagline">{settings?.text('tagline') || home?.text('strapline')}</p>
          </div>
          <nav class="sections" aria-label="Sections">
            {sections.map((section) => (
              <a
                href={section.url}
                aria-current={
                  model.key === section.key || model.path.includes(`,${section.id},`)
                    ? 'page'
                    : undefined
                }
              >
                {section.name}
              </a>
            ))}
          </nav>
        </header>
        <main>{children}</main>
        <footer class="site-footer">
          <p>
            <strong>{masthead}</strong> · {settings?.text('tagline')}
          </p>
          {settings?.hasValue('footerNote') ? <p>{settings.text('footerNote')}</p> : null}
        </footer>
      </body>
    </html>
  )
}
