/**
 * The warning an extension's back-office code is granted under (story 320), with
 * its own confirmation, shared by the Marketplace's install and Installed's grant.
 */
import { css, html } from '@umbraco-cms/backoffice/external/lit'

/**
 * @param {ReturnType<typeof import('./bundles-backoffice-code-words.js').backOfficeCodeWords>} words
 * @param {boolean} confirmed
 * @param {((confirmed: boolean) => void) | undefined} onConfirm absent once it is granted: there is nothing to confirm
 */
export function backOfficeCodeBlock(words, confirmed, onConfirm) {
  return html`
    <div class="backoffice-code" role="alert">
      <p class="heading"><uui-icon name="icon-alert"></uui-icon><strong>${words.label}</strong></p>
      ${words.reason ? html`<p class="reason">${words.reason}</p>` : ''}
      <p>${words.warning}</p>
      <p>${words.publisher} ${words.signature}</p>
      ${
        onConfirm
          ? html`<uui-checkbox
              label=${words.confirm}
              .checked=${confirmed}
              @change=${(event) => onConfirm(event.target.checked)}></uui-checkbox>`
          : ''
      }
    </div>
  `
}

export const backOfficeCodeStyles = css`
  .backoffice-code {
    margin: var(--uui-size-space-3) 0;
    padding: var(--uui-size-space-4);
    border: 1px solid var(--uui-color-warning-standalone, var(--uui-color-warning));
    border-radius: var(--uui-border-radius);
    background: var(--uui-color-warning-surface, var(--uui-color-surface-alt));
  }
  .backoffice-code p {
    margin: 0 0 var(--uui-size-space-2);
  }
  .backoffice-code .heading {
    display: flex;
    align-items: center;
    gap: var(--uui-size-space-2);
    color: var(--uui-color-warning-standalone, var(--uui-color-warning-emphasis));
  }
  .backoffice-code .reason {
    color: var(--uui-color-text-alt);
  }
`
