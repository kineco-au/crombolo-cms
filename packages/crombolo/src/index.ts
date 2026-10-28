/**
 * The umbrella package a site installs.
 *
 * A site's `server.ts` is three lines:
 *
 *   import { crombolo } from '@crombolo/crombolo'
 *   import config from './crombolo.config.ts'
 *   Bun.serve(await crombolo(config))
 */
import {
  assertPortAvailable,
  type CromboloConfig,
  createServer,
  loadConfig,
  type ServerHandle,
} from '@crombolo/server'

// What a bundle's package.json declares; see `docs/bundles.md`.
export type { BundlePackage, CromboloField, PackageJson } from '@crombolo/backoffice-host'
// The CMS's own checks of a bundle package, for a host that installs them (story 181).
export { peerRangeProblem, validateBundlePackage } from '@crombolo/backoffice-host'
// A view reads a form definition and a submission's state; both are domain
// types, so they come from core rather than from the renderer.
export type {
  FormCondition,
  FormFieldError,
  FormFieldType,
  FormSubmissionState,
  SchemaForm,
  SchemaFormField,
  SchemaFormGroup,
  SchemaFormPage,
  SubmittedValues,
} from '@crombolo/core'
export { allFormFields, formFieldType, storingFormFields } from '@crombolo/core'
export {
  assertBundleTables,
  type BundleStep,
  type BundleTables,
  type BundleTablesCapability,
  bundleTablesCompatibility,
  defineBundleTables,
  type LiveNode,
  liveNodes,
  type TableHandle,
  type Where,
} from '@crombolo/data'
export type {
  BlockGridArea,
  BlockGridItem,
  BlockGridValue,
  BlockItem,
  BlockProps,
  BlocksProps,
  CSSProperties,
  EmailField,
  EmailLayoutProps,
  EmailProps,
  ExcerptSegment,
  ExtraAttributes,
  FormFieldComponents,
  FormFieldRenderer,
  FormFieldRenderProps,
  FormProps,
  InnerHTML,
  Link,
  Menu,
  MenuItem,
  Navigation,
  PageProps,
  PublishedContent,
  PublishedElement,
  RedirectOptions,
  RedirectRule,
  RedirectTo,
  RequestMember,
  SearchOptions,
  SearchResult,
  SearchResults,
  SeoHeadProps,
  SeoOverrides,
  SeoSiteDefaults,
  TypedElement,
} from '@crombolo/render'
export {
  Blocks,
  type Context,
  createContext,
  externalSignInUrl,
  Form,
  formAction,
  type ProviderProps,
  redirect,
  SeoHead,
  search,
  useContext,
  useId,
  usePage,
} from '@crombolo/render'
export type { Child } from '@crombolo/render/jsx-runtime'
// A site's code from its bundle, checked and installed by a host in its own process (story 192).
export {
  // What a bundle's server half is written against; see `docs/bundles.md`.
  type AppAlias,
  type AzureMediaStoreOptions,
  type AzureSchemaStoreOptions,
  awsIdentityCenter,
  azureMediaStore,
  azureSchemaStore,
  type BundleCapability,
  type BundleCodeCheck,
  type BundleCodeInstall,
  type BundleCodeOptions,
  type BundleDocuments,
  type BundleHost,
  type BundleLog,
  type BundleMethod,
  type BundleRedirectInput,
  type BundleRedirectRule,
  type BundleRedirects,
  type BundleReload,
  type BundleRequest,
  type BundleSection,
  type CromboloConfig,
  type CustomEmailOptions,
  checkBundleCode,
  createServer,
  customEmail,
  defineConfig,
  type EmailAddress,
  type EmailAttachment,
  type EmailMessage,
  type EmailPort,
  type EmailResult,
  entra,
  fileSystemMediaStore,
  type IdentityProvider,
  type IdentityProviderOptions,
  installBundleCode,
  loadConfig,
  logEmail,
  type MediaStore,
  mediaStoreFor,
  oidc,
  type PostmarkOptions,
  type Principal,
  postmarkEmail,
  type ReloadedBundle,
  type ResendOptions,
  resendEmail,
  type S3MediaStoreOptions,
  type S3SchemaStoreOptions,
  type SchemaStore,
  type ServerBundle,
  type ServerBundleRoute,
  type ServerHandle,
  type SesOptions,
  s3MediaStore,
  s3SchemaStore,
  sesEmail,
  VERSION,
} from '@crombolo/server'

/** Boots a site and returns what `Bun.serve` needs, the live-update WebSocket included. */
export async function crombolo(
  overrides: Partial<CromboloConfig> = {},
  cwd = process.cwd(),
): Promise<ServerHandle['serveOptions']> {
  return (await cromboloServer(overrides, cwd)).serveOptions
}

/**
 * Boots a site and returns the server handle: `serveOptions` for `Bun.serve`,
 * and `reloadBundles()` for a host that changes the site's packages while it
 * runs (story 181). `crombolo()` is this, for a `server.ts` that needs neither.
 */
export async function cromboloServer(
  overrides: Partial<CromboloConfig> = {},
  cwd = process.cwd(),
): Promise<ServerHandle> {
  const config = loadConfig(overrides, cwd)
  // The caller is about to serve, so fail here rather than after a migration and a seed.
  await assertPortAvailable(config.port)
  return createServer(config)
}
