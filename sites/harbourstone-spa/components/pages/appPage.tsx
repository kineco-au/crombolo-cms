import type { PageProps } from '@crombolo/crombolo'
import { redirect } from '@crombolo/crombolo/navigation'

/**
 * Every page but the login page is drawn by the app in web/, so here each one
 * sends the visitor to its address there (`seo.publicUrl` in crombolo.config.ts).
 */
export default function AppPage({ model, request, urls }: PageProps) {
  const there = urls.absolute(model)
  if (there && new URL(there).origin !== new URL(request.url).origin) redirect(there)
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>{model.text('title') || model.name}</title>
      </head>
      <body>
        <p>This page is shown by the Harbourstone app.</p>
      </body>
    </html>
  )
}
