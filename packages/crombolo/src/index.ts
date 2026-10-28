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
  MediaWithCrops,
  Menu,
  MenuItem,
  Navigation,
  PageProps,
  PublishedContent,
  PublishedElement,
  PublishedMedia,
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
  AntiforgeryMeta,
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
export {
  type AzureMediaStoreOptions,
  type AzureSchemaStoreOptions,
  awsIdentityCenter,
  azureMediaStore,
  azureSchemaStore,
  type CromboloConfig,
  type CustomEmailOptions,
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
  logEmail,
  type MediaStore,
  mediaStoreFor,
  oidc,
  type PostmarkOptions,
  postmarkEmail,
  type ResendOptions,
  resendEmail,
  type S3MediaStoreOptions,
  type S3SchemaStoreOptions,
  type SchemaStore,
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

/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
export type { BundlePackage, CromboloField, PackageJson } from '@crombolo/backoffice-host'
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
export { peerRangeProblem, validateBundlePackage } from '@crombolo/backoffice-host'
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
export type {
  BundleStep,
  BundleTables,
  BundleTablesCapability,
  LiveNode,
  TableHandle,
  Where,
} from '@crombolo/data'
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
export {
  assertBundleTables,
  bundleTablesCompatibility,
  defineBundleTables,
  liveNodes,
} from '@crombolo/data'
// Deprecated at the root since 0.34.0 (story 173): each still works here for one
// minor, and moves to the entry point its note names. `docs/api.md`.
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/bundle`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
export type {
  AppAlias,
  BundleCapability,
  BundleCodeCheck,
  BundleCodeInstall,
  BundleCodeOptions,
  BundleDocuments,
  BundleHost,
  BundleLog,
  BundleMethod,
  BundleRedirectInput,
  BundleRedirectRule,
  BundleRedirects,
  BundleReload,
  BundleRequest,
  BundleSection,
  Principal,
  ReloadedBundle,
  ServerBundle,
  ServerBundleRoute,
} from '@crombolo/server'
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
/** @deprecated Import it from `@crombolo/crombolo/host`. */
export { checkBundleCode, createServer, installBundleCode, loadConfig } from '@crombolo/server'
