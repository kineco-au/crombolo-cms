import { type Child, type Navigation, type PublishedContent, usePage } from '@crombolo/crombolo'

/**
 * The shell every page shares: the masthead, the sections, and the footer from
 * the site's settings page (story 058). The face is Newsreader for headlines
 * and Inter for the rest, from Google Fonts; `css/tailwind.css` names fallbacks,
 * so a blocked request degrades to the system serif and sans.
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
    <html lang="en" class="scheme-light-dark">
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
      </head>
      <body class="bg-paper font-sans text-base/relaxed text-ink antialiased">
        <header class="border-b border-rule">
          <div class="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-5 gap-y-1 px-5 pt-7 pb-2">
            <a
              class="font-serif text-3xl/none font-bold tracking-tight sm:text-4xl"
              href={home?.url ?? '/'}
            >
              {masthead}
            </a>
            <p class="text-muted">{settings?.text('tagline') || home?.text('strapline')}</p>
          </div>
          <nav
            class="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-1 px-5 pt-2 pb-3 font-medium"
            aria-label="Sections"
          >
            {sections.map((section) => (
              <a
                class="border-b-2 border-transparent pb-0.5 text-muted hover:border-accent hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink"
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
        <main class="mx-auto max-w-6xl px-5 pt-8 pb-16 sm:pt-10">{children}</main>
        <footer class="border-t border-rule">
          <div class="mx-auto max-w-6xl space-y-1 px-5 pt-6 pb-12 text-sm text-muted">
            <p>
              <strong class="font-semibold text-ink">{masthead}</strong> ·{' '}
              {settings?.text('tagline')}
            </p>
            {settings?.hasValue('footerNote') ? <p>{settings.text('footerNote')}</p> : null}
          </div>
        </footer>
      </body>
    </html>
  )
}
