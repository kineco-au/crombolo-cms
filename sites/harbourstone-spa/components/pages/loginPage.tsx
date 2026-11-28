import type { PageProps } from '@crombolo/crombolo'

const label = 'text-xs font-medium tracking-[0.14em] text-muted uppercase'
const field =
  'w-full rounded-none border border-line bg-card p-3 text-base text-ink outline-none focus-visible:border-brass motion-safe:transition-colors'

/**
 * Where member sign-in from the app sends a member who is not signed in yet. The
 * form posts to the site, which signs them in and sends them on to `returnUrl`:
 * back to the sign-in they started, and from there to the app.
 */
export default async function LoginPage({ model, member, searchParams }: PageProps) {
  const query = await searchParams
  const returnUrl = typeof query.returnUrl === 'string' ? query.returnUrl : '/'
  // A wrong password goes back to `returnUrl` with this flag, and so comes back here inside it.
  const failed = query.memberLoginFailed !== undefined || returnUrl.includes('memberLoginFailed=1')
  return (
    <html lang="en" class="antialiased">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{model.text('title')} — Harbourstone</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@300;400;500&display=swap"
        />
      </head>
      <body class="bg-paper font-sans leading-normal font-light text-ink selection:bg-selection selection:text-ink">
        <header class="border-b border-line">
          <div class="mx-auto w-full max-w-6xl px-5 py-3 sm:px-8 md:py-4">
            <span class="font-display text-xl tracking-wide sm:text-2xl">
              Harbour<span class="text-brass-deep">stone</span>
            </span>
          </div>
        </header>
        <main class="mx-auto w-full max-w-6xl px-5 pt-16 pb-24 sm:px-8 md:pt-24">
          <h1 class="font-display text-5xl leading-none font-medium tracking-tight text-balance md:text-7xl">
            {model.text('title')}
          </h1>
          {model.hasValue('standfirst') ? (
            <p class="mt-6 max-w-xl text-lg text-pretty text-muted">{model.text('standfirst')}</p>
          ) : null}
          <section class="mt-12 max-w-md">
            {member ? (
              <p>
                You are signed in as {member.name}.{' '}
                <a class="text-brass-deep underline underline-offset-4" href={returnUrl}>
                  Carry on
                </a>
              </p>
            ) : (
              <form class="grid gap-6" method="post" action="/umbraco/members/login">
                <input type="hidden" name="returnUrl" value={returnUrl} />
                {failed ? (
                  <p role="alert" class="border border-wine bg-wine/5 p-4 text-wine">
                    That e-mail address or password is not right.
                  </p>
                ) : null}
                <div class="grid gap-2">
                  <label class={label} for="username">
                    E-mail address
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autocomplete="username"
                    required
                    class={field}
                  />
                </div>
                <div class="grid gap-2">
                  <label class={label} for="password">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    required
                    class={field}
                  />
                </div>
                <button
                  class="mt-2 min-h-11 cursor-pointer justify-self-start bg-ink px-6 text-xs font-medium tracking-caps text-foam uppercase hover:bg-brass-deep motion-safe:transition-colors"
                  type="submit"
                >
                  Sign in
                </button>
              </form>
            )}
          </section>
        </main>
      </body>
    </html>
  )
}
