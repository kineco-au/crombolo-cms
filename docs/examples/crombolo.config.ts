/**
 * Every field a site can set in crombolo.config.ts, with the variable that sets
 * it from the environment where there is one. A reference, not a site to copy:
 * set only what differs from the defaults. Type-checked with the repository, so
 * it stays true to the config (docs/configuration.md).
 */
import {
  awsIdentityCenter,
  defineConfig,
  defineSiteTables,
  entra,
  gitHub,
  oidc,
  redirect,
  resendEmail,
  s3MediaStore,
} from '@crombolo/crombolo'
import { route } from '@crombolo/crombolo/routes'
import { redirects } from '@crombolo/simple-redirects'

const env = process.env

export default defineConfig({
  // ── The site ────────────────────────────────────────────────────────────────
  siteName: 'Riverside Bakery', // CROMBOLO_SITE_NAME
  applicationUrl: 'https://www.riverside-bakery.example', // CROMBOLO_APPLICATION_URL
  contentMode: 'production', // CROMBOLO_CONTENT_MODE: templates, styles and scripts read-only

  // ── Where its files are (relative to this file) ─────────────────────────────
  siteDir: '.',
  schemaDir: 'schema', // CROMBOLO_SCHEMA_DIR
  componentsDir: 'components', // CROMBOLO_COMPONENTS_DIR
  componentsCacheDir: '.crombolo/views', // CROMBOLO_COMPONENTS_CACHE_DIR
  stylesheetsDir: 'css', // CROMBOLO_CSS_DIR
  scriptsDir: 'scripts', // CROMBOLO_SCRIPTS_DIR
  publicDir: 'public', // CROMBOLO_PUBLIC_DIR
  mediaDir: 'media', // CROMBOLO_MEDIA_DIR
  logsDir: 'logs', // CROMBOLO_LOGS_DIR

  // ── Server ──────────────────────────────────────────────────────────────────
  port: 8080, // PORT
  role: 'all', // CROMBOLO_ROLE: all, api, web or worker
  runJobs: true, // CROMBOLO_JOBS
  nodeId: 'web-1', // CROMBOLO_NODE_ID
  development: false, // from NODE_ENV
  maxRequestBodyBytes: 50 * 1024 * 1024, // CROMBOLO_MAX_REQUEST_BODY_MB
  trustedProxies: ['10.0.0.0/8'], // CROMBOLO_TRUSTED_PROXIES
  secureCookies: true, // CROMBOLO_INSECURE_COOKIES turns it off
  allowPrivateAddresses: false, // CROMBOLO_ALLOW_PRIVATE_ADDRESSES
  immutableAssets: true, // config only: on unless in development
  liveReload: false, // CROMBOLO_LIVE_RELOAD

  // ── Database ────────────────────────────────────────────────────────────────
  // The Postgres address and password stay in CROMBOLO_POSTGRES_URL: there is no field.
  dialect: 'postgres', // CROMBOLO_DB
  sqliteFile: 'crombolo.sqlite', // CROMBOLO_SQLITE_FILE
  pgDump: 'pg_dump "$CROMBOLO_POSTGRES_URL" -f "backup-$CROMBOLO_BACKUP_STAMP.sql"', // CROMBOLO_PG_DUMP
  upgradePolicy: 'strict', // CROMBOLO_UPGRADE_POLICY
  database: {
    tables: defineSiteTables([]), // the site's own tables, migrated with crombolo's
  },

  // ── Schema ──────────────────────────────────────────────────────────────────
  schemaRevision: 'build-1234', // CROMBOLO_SCHEMA_REVISION
  schemaStore: undefined, // config only: schemaStoreOver(store), to keep the schema in cloud storage
  schemaCacheDir: '/tmp/crombolo-schema', // CROMBOLO_SCHEMA_CACHE_DIR
  schemaWritable: false, // CROMBOLO_SCHEMA_WRITABLE
  syncSchemaAtBoot: true, // CROMBOLO_SYNC_SCHEMA_AT_BOOT

  // ── Rendering ───────────────────────────────────────────────────────────────
  componentsSnapshot: { maxGenerations: 3 },
  renderTimeoutMs: 10_000, // CROMBOLO_RENDER_TIMEOUT_MS
  middleware: {
    request: [
      {
        name: 'security-headers',
        handle: async (request, next) => {
          const response = await next(request)
          response.headers.set('x-frame-options', 'DENY')
          return response
        },
      },
    ],
  },
  middlewareTimeoutMs: 2_000, // CROMBOLO_MIDDLEWARE_TIMEOUT_MS
  routes: [route('/api/opening-hours', { GET: () => Response.json({ open: '07:00' }) })],
  routeTimeoutMs: 10_000, // CROMBOLO_ROUTE_TIMEOUT_MS
  routeRateLimitPerMinute: 60, // CROMBOLO_ROUTE_RATE_LIMIT_PER_MINUTE
  actions: {},
  islands: { manifest: 'dist/islands/manifest.json' },
  pages: { notFound: '/not-found', unauthorized: '/sign-in', error: '/error' },
  errors: { showDetails: false }, // CROMBOLO_SHOW_ERROR_DETAILS

  // ── Addresses ───────────────────────────────────────────────────────────────
  redirects: [redirect('/old-menu', '/menu'), redirect('/blog/*', '/news')],
  trackRedirects: true, // CROMBOLO_TRACK_REDIRECTS

  // ── Search & sharing ────────────────────────────────────────────────────────
  seo: {
    sitemap: true, // CROMBOLO_SITEMAP
    indexable: true, // CROMBOLO_INDEXABLE
    robotsTxt: 'User-agent: *\nDisallow: /checkout',
    siteName: 'Riverside Bakery',
    titleSuffix: ' | Riverside Bakery',
    defaultImage: '/images/share.jpg',
    notFoundPage: '/not-found',
    publicUrl: 'https://www.riverside-bakery.example',
  },
  search: { matchLimit: 500 }, // backoffice and site providers default to the database's own

  // ── Caching ─────────────────────────────────────────────────────────────────
  cache: {
    maxAge: 60, // CROMBOLO_CACHE_MAX_AGE
    staleWhileRevalidate: 300,
    staleIfError: 86_400,
    tagHeader: 'Surrogate-Key',
    types: { newsArticle: { maxAge: 300 } },
  },

  // ── Media ───────────────────────────────────────────────────────────────────
  mediaStore: s3MediaStore({
    bucket: 'riverside-media',
    region: 'ap-southeast-2',
  }), // CROMBOLO_MEDIA_STORE and CROMBOLO_MEDIA_*
  mediaCacheMegabytes: 256, // CROMBOLO_MEDIA_CACHE_MB

  // ── E-mail ──────────────────────────────────────────────────────────────────
  email: resendEmail({
    apiKey: env.RESEND_API_KEY ?? '',
    from: { email: 'hello@riverside-bakery.example', name: 'Riverside Bakery' },
  }), // CROMBOLO_EMAIL_*; null turns e-mail off
  sendUserLink: undefined, // how invitations and resets are sent; from `email` unless set

  // ── Back office ─────────────────────────────────────────────────────────────
  backOfficePath: '/crombolo', // CROMBOLO_BACKOFFICE_PATH
  defaultUiLanguage: 'en-US',
  keepUserLoggedIn: false,
  allowLocalLogin: true,
  allowPasswordReset: true,
  usernameIsEmail: true,
  versionCheckPeriod: 7,
  umbracoCssPath: 'css',
  signalRSkipNegotiation: false,

  // ── Signing in, first run, keys ─────────────────────────────────────────────
  // Secrets are better left to the environment; each has a variable.
  secretKey: env.CROMBOLO_SECRET_KEY, // CROMBOLO_SECRET_KEY
  adminLogin: 'admin@riverside-bakery.example', // CROMBOLO_ADMIN_LOGIN
  adminPassword: env.CROMBOLO_ADMIN_PASSWORD, // CROMBOLO_ADMIN_PASSWORD
  setupCode: env.CROMBOLO_SETUP_CODE, // CROMBOLO_SETUP_CODE
  localAdmin: false, // CROMBOLO_LOCAL_ADMIN
  apiClient: undefined, // CROMBOLO_API_CLIENT_ID and CROMBOLO_API_CLIENT_SECRET
  backofficeIdentityProviders: [
    entra({
      tenantId: env.ENTRA_TENANT_ID ?? '',
      clientId: env.ENTRA_CLIENT_ID ?? '',
      locked: true,
    }),
  ],
  lockedIdentityProviders: [], // CROMBOLO_LOCKED_IDENTITY_PROVIDERS
  host: undefined, // a host service the back office vouches for its user to

  // ── Members ─────────────────────────────────────────────────────────────────
  allowMemberRegistration: true, // CROMBOLO_ALLOW_MEMBER_REGISTRATION
  memberRegistrationType: 'Member',
  memberRegistrationGroups: ['Customers'],
  memberSessionMinutes: 60 * 24 * 14,
  maxFailedPasswordAttempts: 5,
  memberIdentityProviders: [
    oidc({
      id: 'google',
      name: 'Google',
      issuer: 'https://accounts.google.com',
      clientId: env.GOOGLE_CLIENT_ID ?? '',
    }),
    awsIdentityCenter({ issuer: 'https://example.awsapps.com', clientId: 'riverside' }),
  ],

  // ── Delivery API, for a front end built apart ───────────────────────────────
  deliveryApi: {
    enabled: true, // CROMBOLO_DELIVERY_API
    publicAccess: false,
    apiKey: env.CROMBOLO_DELIVERY_API_KEY, // CROMBOLO_DELIVERY_API_KEY
    allowedContentTypeAliases: [],
    disallowedContentTypeAliases: ['settings'],
    media: { enabled: true, publicAccess: true },
    cors: { allowedOrigins: ['https://app.riverside-bakery.example'] },
    preview: { url: 'https://app.riverside-bakery.example/api/preview?path={path}&token={token}' },
  },

  // ── Moving and deploying ────────────────────────────────────────────────────
  remote: {
    enabled: true,
    access: 'content', // CROMBOLO_REMOTE_ACCESS
    environment: 'production', // CROMBOLO_REMOTE_ENVIRONMENT
    protected: true,
    approvals: true,
    maxUploadBytes: 500 * 1024 * 1024,
    oidcIssuers: ['https://gitlab.riverside-bakery.example'],
  },
  git: { provider: gitHub({ repository: 'riverside/site', token: env.GITHUB_TOKEN ?? '' }) },

  // ── Extensions and bundles ──────────────────────────────────────────────────
  bundles: [redirects()],
  extensions: {
    'acme-seo': { grant: ['content:read'], settings: { region: 'au' }, timeoutMs: 5_000 },
  },
  trustedKeys: [{ name: 'Riverside CI', publicKey: 'MCowBQYDK2VwAyEA…', kind: 'site' }],
  trustedSources: [{ name: 'Our extensions', source: 'github.com/riverside/*' }],
  bundlePolicy: { signatures: 'required', sources: ['github.com/riverside/*'] },
  unrestrictedExtensions: 'config', // CROMBOLO_UNRESTRICTED_EXTENSIONS
  hostProvided: [],
  applyBundleContentOnInstall: true,
  runtimeInstalls: false, // CROMBOLO_RUNTIME_INSTALLS
  installsElsewhere: { message: 'Extensions are installed by the hosting team.' },
  marketplaceUrl: 'https://marketplace.crombolo.example', // CROMBOLO_MARKETPLACE_URL
  packageKeyword: 'crombolo-bundle',
  npmRegistry: 'https://registry.npmjs.org', // CROMBOLO_NPM_REGISTRY
  webhooks: { headerVariables: ['SEARCH_SERVICE_TOKEN'] },

  // ── Jobs, events and site code ──────────────────────────────────────────────
  jobs: {},
  queries: {},
  schedules: [{ job: 'reports.weekly', cron: '0 6 * * 1', timezone: 'Australia/Sydney' }],
  events: {},
  content: { actAs: 'automation@riverside-bakery.example' },

  // ── Housekeeping ────────────────────────────────────────────────────────────
  versionCleanup: {
    enabled: true, // CROMBOLO_VERSION_CLEANUP
    keepAllVersionsNewerThanDays: 7,
    keepLatestVersionPerDayForDays: 90,
  },
  auditRetentionDays: 365, // CROMBOLO_AUDIT_RETENTION_DAYS
  extensionActivityDays: 30,
  eventRetentionDays: 30,

  // ── Logs and telemetry ──────────────────────────────────────────────────────
  logLevel: 'info', // CROMBOLO_LOG_LEVEL
  logToConsole: true,
  diagnostics: { traceRequests: false, heapIntervalSeconds: 0 },
  telemetry: { endpoint: 'https://otel.riverside-bakery.example', serviceName: 'riverside' },
})
