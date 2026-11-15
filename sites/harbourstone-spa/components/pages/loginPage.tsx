import { asset, type PageProps } from '@crombolo/crombolo'

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
    <html lang="en">
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
        <link rel="stylesheet" href={asset('/css/site.css')} />
      </head>
      <body>
        <header class="masthead">
          <div class="masthead__inner">
            <span class="wordmark">
              Harbour<span>stone</span>
            </span>
          </div>
        </header>
        <main>
          <header class="page-header">
            <h1>{model.text('title')}</h1>
            {model.hasValue('standfirst') ? (
              <p class="standfirst">{model.text('standfirst')}</p>
            ) : null}
          </header>
          <section class="contact">
            {member ? (
              <p>
                You are signed in as {member.name}. <a href={returnUrl}>Carry on</a>
              </p>
            ) : (
              <form class="crombolo-form" method="post" action="/umbraco/members/login">
                <input type="hidden" name="returnUrl" value={returnUrl} />
                {failed ? <p role="alert">That e-mail address or password is not right.</p> : null}
                <div class="crombolo-form__group">
                  <label class="crombolo-form__label" for="username">
                    E-mail address
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autocomplete="username"
                    required
                  />
                </div>
                <div class="crombolo-form__group">
                  <label class="crombolo-form__label" for="password">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    required
                  />
                </div>
                <button class="button" type="submit">
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
