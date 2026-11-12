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
        <style>{`
          body { margin: 0; font-family: system-ui, sans-serif; color: #1f2933; background: #f7f8fa; }
          main { max-width: 44rem; margin: 0 auto; padding: 4rem 1.5rem; text-align: center; }
          img { max-width: 100%; height: auto; max-height: 8rem; margin-bottom: 2rem; }
          h1 { font-size: 2.5rem; margin: 0 0 1rem; }
          p { font-size: 1.125rem; line-height: 1.6; }
        `}</style>
      </head>
      <body>
        <main>
          {image ? <img src={image.cropUrl({ width: 800 })} alt={image.name} /> : null}
          <h1>{model.text('title') || model.name}</h1>
          {model.hasValue('description') ? <p>{model.text('description')}</p> : null}
        </main>
      </body>
    </html>
  )
}
