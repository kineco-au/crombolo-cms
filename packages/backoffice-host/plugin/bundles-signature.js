/** The signature as the Bundles screens show it (story 060): a tag, a line, its links, any refusal. */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'

export { signatureWords } from './bundles-signature-words.js'

/** @param {ReturnType<typeof import('./bundles-signature-words.js').signatureWords>} words */
export function signatureBlock(words) {
  return html`
    <div class="signature" data-tone=${words.tone}>
      <uui-tag look=${words.tone === 'positive' ? 'primary' : 'secondary'} color=${words.tone === 'default' ? 'default' : words.tone}>${words.label}</uui-tag>
      <span>${words.detail}</span>
      ${words.links.map(
        (link) => html`<a href=${link.href} target="_blank" rel="noopener">${link.label}</a>`,
      )}
      ${words.refusal ? html`<p class="refusal">${words.refusal}</p>` : nothing}
    </div>
  `
}

/** The block's look, for the screens that show it. */
export const signatureStyles = css`
  .signature {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--uui-size-space-3, 9px);
    margin: var(--uui-size-space-3, 9px) 0;
    font-size: 0.9em;
  }
  .signature .refusal {
    flex-basis: 100%;
    margin: 0;
    color: var(--uui-color-danger, #d42054);
  }
`
