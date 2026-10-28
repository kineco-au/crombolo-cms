/**
 * What a bundle adds, as the Marketplace and Installed views both show it.
 */
import { html } from '@umbraco-cms/backoffice/external/lit'

/** What a bundle adds, in the words of someone choosing one. */
export const CARRIES_LABELS = {
  extensions: 'Screens',
  content: 'Content',
  server: 'Runs code on the server',
}

/** Server code is a different kind of thing to add, so it looks like one (story 194). */
export const carriesTags = (carries) =>
  Object.entries(CARRIES_LABELS)
    .filter(([key]) => carries?.[key])
    .map(([key, label]) =>
      key === 'server'
        ? html`<uui-tag look="primary" color="warning">${label}</uui-tag>`
        : html`<uui-tag look="secondary">${label}</uui-tag>`,
    )
