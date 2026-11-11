/**
 * The supported API for whoever runs sites (story 173): booting a site from
 * its config, the stores it keeps media and schema in, checking and installing
 * a site's bundles and code, checking a bundle's signature as the CMS does
 * (story 244), the upgrade, import and export a deploy runs, and the role and
 * schema a custom-table owner needs, for a host that makes them itself (story 321),
 * and installing extensions into their roots as the CMS does (story 332).
 * `docs/api.md`.
 */
export type {
  BundlePackage,
  CromboloField,
  ExtensionRecord,
  PackageJson,
  RecordedExtension,
} from '@crombolo/backoffice-host'
export {
  grantHashOf,
  INSTALLED_AS_DEPENDENCY,
  peerRangeProblem,
  RECORD_FILE,
  ROOTS_DIR,
  readRecord,
  recordProblems,
  rootOf,
  validateBundlePackage,
} from '@crombolo/backoffice-host'
export {
  contentCheck,
  contentImport,
  findTemplate,
  type SiteTemplate,
  siteExport,
  type UpgradePlanResult,
  upgradeFix,
  upgradePlan,
} from '@crombolo/cli'
export {
  type LiveNode,
  liveNodes,
  type OwnerSetup,
  type OwnerSetupInput,
  ownerSetup,
} from '@crombolo/data'
export {
  type AzureMediaStoreOptions,
  type AzureSchemaStoreOptions,
  azureMediaStore,
  azureSchemaStore,
  type BundleCodeCheck,
  type BundleCodeInstall,
  type BundleCodeOptions,
  type BundleCodeRoot,
  type BundleReload,
  type ContentCheckResult,
  type ContentImportInput,
  type ContentImportResult,
  type CromboloConfig,
  checkBundleCode,
  createServer,
  describeProvenance,
  fileSystemMediaStore,
  type InstallExtensionOptions,
  type InstallExtensionResult,
  installBundleCode,
  installExtension,
  loadConfig,
  type MediaStore,
  mediaStoreFor,
  type ProvenanceLinks,
  type ProvenancePolicy,
  type ProvenanceResult,
  type ProvenanceSource,
  type ProvenanceState,
  provenanceProblem,
  type ReloadedBundle,
  removeExtension,
  type S3MediaStoreOptions,
  type S3SchemaStoreOptions,
  type SchemaStore,
  type ServerHandle,
  type SignaturePolicy,
  s3MediaStore,
  s3SchemaStore,
  type TransferInput,
  VERSION,
  type VerifyProvenanceOptions,
  type Vouch,
  verifyPackage,
  verifyProvenance,
} from '@crombolo/server'
// A node that runs only the background jobs (story 223), for a host that
// boots its own nodes: `createServer` refuses the worker role.
export { createWorker, type WorkerHandle, type WorkerHealth } from '@crombolo/server/worker'
export { cromboloServer } from './index.ts'
