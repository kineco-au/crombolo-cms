/** Class lists more than one view shares, so the measure and the button stay one thing. */

/** The column every section's content sits in: the measure and the gutter. */
export const shell = 'mx-auto w-full max-w-6xl px-5 sm:px-8'

/** A heading in the display serif. Sizes are the view's. */
export const display = 'font-display font-medium tracking-tight text-balance'

/** An outlined link that fills on hover; `light` sits on a photograph or the sea. */
export function button(tone?: 'light'): string {
  const base =
    'inline-flex min-h-11 items-center border px-5 text-xs font-medium tracking-caps uppercase no-underline motion-safe:transition-colors'
  return tone === 'light'
    ? `${base} border-brass text-foam hover:bg-brass hover:text-ink`
    : `${base} border-ink hover:bg-ink hover:text-foam`
}

/** A text box: the search fields. */
export const field =
  'w-full border border-line bg-card px-3 py-3 text-base text-ink outline-none focus-visible:border-brass motion-safe:transition-colors'
