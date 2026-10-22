/**
 * Umbraco's `DeliveryApiSettings`, with its defaults: off until a site turns
 * it on. docs/delivery-api.md, "Settings".
 */

export interface DeliveryApiClientMember {
  /** The member this client signs in as. */
  userName: string
  /** Sent as `umbraco-member-<clientId>`; the prefix is added when missing. */
  clientId: string
  clientSecret: string
}

export interface DeliveryApiSettings {
  enabled: boolean
  /** False: every content request needs the API key. */
  publicAccess: boolean
  /** Unlocks non-public access and preview. Unset, nothing can preview. */
  apiKey: string | undefined
  /** When any are listed, only these content types are served. */
  allowedContentTypeAliases: string[]
  /** Never served; ignored when the allow list has entries. */
  disallowedContentTypeAliases: string[]
  media: { enabled: boolean; publicAccess: boolean }
  /**
   * Origins whose pages may call the API from the browser, e.g.
   * `https://app.example.com`; `*` for any, only while the API is public.
   */
  cors: { allowedOrigins: string[] }
  /**
   * Previewing drafts in an app (story 053): where the backoffice's Preview
   * button sends an editor, with `{path}`, `{id}`, `{culture}` and `{token}`
   * filled in; per content type alias in `urls`, which wins over `url`.
   */
  preview: { url: string | undefined; urls: Record<string, string>; tokenMinutes: number }
  memberAuthorization: {
    authorizationCodeFlow: {
      enabled: boolean
      /** Absolute URLs an app may be sent back to after signing in. */
      loginRedirectUrls: string[]
      logoutRedirectUrls: string[]
      /**
       * The site page holding the member login form, e.g. `/login`. A member who
       * is not signed in is sent there with `returnUrl`, and comes back to finish.
       */
      loginPage: string | undefined
    }
    clientCredentialsFlow: { enabled: boolean; associatedMembers: DeliveryApiClientMember[] }
    /** Umbraco's `Global:TimeOut`: a refresh token lasts this long, an access token a quarter of it. */
    timeoutMinutes: number
  }
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** What a site may set: any part of the settings. */
export type DeliveryApiOptions = DeepPartial<DeliveryApiSettings>

export const CLIENT_ID_PREFIX = 'umbraco-member-'

/** The client id a caller sends for a configured member client. Pure. */
export const memberClientId = (id: string): string =>
  id.startsWith(CLIENT_ID_PREFIX) ? id : `${CLIENT_ID_PREFIX}${id}`

/** The settings with every default filled in. Pure. */
export function resolveDeliveryApiSettings(options: DeliveryApiOptions = {}): DeliveryApiSettings {
  const code = options.memberAuthorization?.authorizationCodeFlow ?? {}
  const credentials = options.memberAuthorization?.clientCredentialsFlow ?? {}
  return {
    enabled: options.enabled ?? false,
    publicAccess: options.publicAccess ?? true,
    apiKey: options.apiKey?.trim() ? options.apiKey : undefined,
    allowedContentTypeAliases: [...(options.allowedContentTypeAliases ?? [])].filter(
      (alias): alias is string => typeof alias === 'string',
    ),
    disallowedContentTypeAliases: [...(options.disallowedContentTypeAliases ?? [])].filter(
      (alias): alias is string => typeof alias === 'string',
    ),
    media: {
      enabled: options.media?.enabled ?? false,
      publicAccess: options.media?.publicAccess ?? true,
    },
    cors: {
      allowedOrigins: [...(options.cors?.allowedOrigins ?? [])].filter(
        (origin): origin is string => typeof origin === 'string' && origin.trim() !== '',
      ),
    },
    preview: {
      url: options.preview?.url?.trim() || undefined,
      urls: Object.fromEntries(
        Object.entries(options.preview?.urls ?? {}).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].trim() !== '',
        ),
      ),
      tokenMinutes:
        Number.isFinite(options.preview?.tokenMinutes) && (options.preview?.tokenMinutes ?? 0) > 0
          ? (options.preview?.tokenMinutes as number)
          : 60,
    },
    memberAuthorization: {
      authorizationCodeFlow: {
        enabled: code.enabled ?? false,
        loginRedirectUrls: [...(code.loginRedirectUrls ?? [])].filter(
          (url): url is string => typeof url === 'string',
        ),
        logoutRedirectUrls: [...(code.logoutRedirectUrls ?? [])].filter(
          (url): url is string => typeof url === 'string',
        ),
        loginPage: code.loginPage,
      },
      clientCredentialsFlow: {
        enabled: credentials.enabled ?? false,
        associatedMembers: [...(credentials.associatedMembers ?? [])].flatMap((member) =>
          member?.userName && member.clientId && member.clientSecret
            ? [
                {
                  userName: member.userName,
                  clientId: memberClientId(member.clientId),
                  clientSecret: member.clientSecret,
                },
              ]
            : [],
        ),
      },
      timeoutMinutes: options.memberAuthorization?.timeoutMinutes ?? 20,
    },
  }
}

/** Either member flow switched on: only then is a bearer token looked at. Pure. */
export const memberAuthorizationEnabled = (settings: DeliveryApiSettings): boolean =>
  settings.memberAuthorization.authorizationCodeFlow.enabled ||
  settings.memberAuthorization.clientCredentialsFlow.enabled

/** Whether a content type is served, by Umbraco's allow-then-disallow rule. Pure. */
export function isAllowedContentType(settings: DeliveryApiSettings, alias: string): boolean {
  const lower = alias.toLowerCase()
  if (settings.allowedContentTypeAliases.length > 0)
    return settings.allowedContentTypeAliases.some((a) => a.toLowerCase() === lower)
  return !settings.disallowedContentTypeAliases.some((a) => a.toLowerCase() === lower)
}

/** The configuration problems that switch a member flow off, said once at boot. Pure. */
export function memberAuthorizationProblems(settings: DeliveryApiSettings): string[] {
  const problems: string[] = []
  const code = settings.memberAuthorization.authorizationCodeFlow
  const absolute = (url: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
  if (code.enabled) {
    if (code.loginRedirectUrls.length === 0)
      problems.push('No login redirect URLs are set, so member sign-in from an app is off.')
    else if (!code.loginRedirectUrls.every(absolute))
      problems.push(
        'Every login redirect URL must be absolute, so member sign-in from an app is off.',
      )
    if (!code.logoutRedirectUrls.every(absolute))
      problems.push(
        'Every logout redirect URL must be absolute, so member sign-in from an app is off.',
      )
    if (!code.loginPage)
      problems.push(
        'No member login page is set, so a member who is not signed in cannot sign in from an app.',
      )
  }
  return problems
}

/** A preview URL must say where the app is: a scheme and host. Pure. */
const isAppUrl = (url: string) => /^https?:\/\/[^/]+/i.test(url)

/** Preview URLs that cannot be used, said once at boot and then ignored. Pure. */
export function previewProblems(settings: DeliveryApiSettings): string[] {
  const named = [
    ...(settings.preview.url ? [['preview.url', settings.preview.url]] : []),
    ...Object.entries(settings.preview.urls).map(([alias, url]) => [`preview.urls.${alias}`, url]),
  ] as Array<[string, string]>
  return named
    .filter(([, url]) => !isAppUrl(url))
    .map(
      ([name, url]) =>
        `The ${name} "${url}" is ignored: it must start with the app's address, such as https://app.example.com.`,
    )
}

/** The preview URL for a page of this type, or none; a malformed one is never used. Pure. */
export function previewUrlFor(
  settings: DeliveryApiSettings,
  contentTypeAlias: string,
): string | undefined {
  const own = Object.entries(settings.preview.urls).find(
    ([alias]) => alias.toLowerCase() === contentTypeAlias.toLowerCase(),
  )?.[1]
  const url = own ?? settings.preview.url
  return url && isAppUrl(url) ? url : undefined
}

/** Whether any page type previews in an app, so the backoffice offers it. Pure. */
export const previewsInApp = (settings: DeliveryApiSettings): boolean =>
  [settings.preview.url, ...Object.values(settings.preview.urls)].some(
    (url) => url !== undefined && isAppUrl(url),
  )

/** The URL with its placeholders filled, each value escaped for where it sits. Pure. */
export function fillPreviewUrl(
  template: string,
  values: { path: string; id: string; culture: string | null; token: string },
): string {
  return template
    .replaceAll('{path}', values.path.split('/').map(encodeURIComponent).join('/'))
    .replaceAll('{id}', encodeURIComponent(values.id))
    .replaceAll('{culture}', encodeURIComponent(values.culture ?? ''))
    .replaceAll('{token}', encodeURIComponent(values.token))
}
