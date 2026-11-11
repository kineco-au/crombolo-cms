/**
 * How far an extension reaches, at a glance (story 324), shared by the
 * Marketplace's install and Installed: the level's badge and sentence, the
 * four groups, and each permission with its reason only when asked for.
 */
import { css, html, nothing } from '@umbraco-cms/backoffice/external/lit'
import { groupLines, levelWords } from './bundles-level-words.js'

/**
 * @param {{ level?: string, groups?: object, permissions?: { allows: string, reason?: string | null, origins?: string[] }[], unvouched?: string }} item
 * @param {{ heading?: string }} options
 */
export function levelBlock(item, options = {}) {
  const words = levelWords(item.level)
  return html`<div class="level level-${words.color}" role="group" aria-label="What it can reach">
    ${options.heading ? html`<p class="level-heading">${options.heading}</p>` : nothing}
    <p class="level-badge">
      <uui-tag color=${words.color} look="primary">${words.label}</uui-tag>
      <span>${words.sentence}</span>
    </p>
    ${item.unvouched ? html`<p class="level-unvouched">${item.unvouched}</p>` : nothing}
    <dl class="level-groups">
      ${groupLines(item.groups).map(
        (line) => html`<dt>${line.label}</dt>
          <dd>${line.text}</dd>`,
      )}
    </dl>
    ${
      (item.permissions ?? []).length > 0
        ? html`<details class="level-detail">
            <summary>Show each permission and why it asks</summary>
            <ul>
              ${item.permissions.map(
                (ask) =>
                  html`<li>
                    ${ask.allows}${ask.origins?.length ? html`: ${ask.origins.join(', ')}` : nothing}
                    ${ask.reason ? html`<span class="reason">${ask.reason}</span>` : nothing}
                    ${ask.warning ? html`<span class="reason">${ask.warning}</span>` : nothing}
                  </li>`,
              )}
            </ul>
          </details>`
        : nothing
    }
  </div>`
}

export const levelStyles = css`
  .level {
    margin: var(--uui-size-space-3) 0;
    padding: var(--uui-size-space-4);
    border: 1px solid var(--uui-color-border);
    border-radius: var(--uui-border-radius);
  }
  .level-warning {
    border-color: var(--uui-color-warning-standalone, var(--uui-color-warning));
  }
  .level-danger {
    border-color: var(--uui-color-danger-standalone, var(--uui-color-danger));
  }
  .level p {
    margin: 0 0 var(--uui-size-space-3);
  }
  .level-badge {
    display: flex;
    align-items: baseline;
    gap: var(--uui-size-space-3);
  }
  .level-unvouched {
    color: var(--uui-color-danger-standalone, var(--uui-color-danger));
  }
  .level-groups {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--uui-size-space-1) var(--uui-size-space-4);
    margin: 0 0 var(--uui-size-space-3);
  }
  .level-groups dt {
    font-weight: bold;
  }
  .level-groups dd {
    margin: 0;
  }
  .level-detail summary {
    cursor: pointer;
  }
  .level-detail .reason {
    display: block;
    color: var(--uui-color-text-alt);
  }
`
