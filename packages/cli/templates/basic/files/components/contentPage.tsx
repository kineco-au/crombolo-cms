import { type PageProps, SeoHead } from '@crombolo/crombolo'

/** A page's title, image and description; each is left out when the page has none. */
export default async function ContentPage(props: PageProps) {
  const { model } = props
  const image = (await model.media('image'))[0]
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* The title, description and sharing tags, from the page's Search & sharing tab. */}
        <SeoHead {...props} title={model.text('title')} />
      </head>
      {/* Tailwind's classes style it: the server makes their CSS and links it in the head. */}
      <body className="bg-slate-50 font-sans text-slate-800">
        <main className="mx-auto max-w-2xl px-6 py-16 text-center">
          {image ? (
            <img
              className="mx-auto mb-8 h-auto max-h-32 max-w-full"
              src={image.cropUrl({ width: 800 })}
              alt={image.name}
            />
          ) : null}
          <h1 className="mb-4 text-4xl font-bold">{model.text('title') || model.name}</h1>
          {model.hasValue('description') ? (
            <p className="text-lg leading-relaxed">{model.text('description')}</p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
