/**
 * The operations whose document writes go through `@crombolo/content` (story
 * 170). Each announces itself — audit entry, webhook, notification, live event —
 * from the operation, the same way the command line and the jobs do, so the
 * router must not announce them a second time from the operation's name.
 */
export const DOCUMENT_WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  'PostDocument',
  'PutDocumentById',
  'PatchDocumentByIdPatch',
  'PostDocumentCreateAndPublish',
  'PutDocumentByIdUpdateAndPublish',
  'PutDocumentByIdPublish',
  'PutDocumentByIdUnpublish',
  'PutDocumentByIdPublishWithDescendants',
  'PutDocumentByIdMoveToRecycleBin',
  'DeleteDocumentById',
  'DeleteRecycleBinDocumentById',
  'DeleteRecycleBinDocument',
  'PutRecycleBinDocumentByIdRestore',
  'PutDocumentByIdMove',
  'PostDocumentByIdCopy',
  'PutDocumentSort',
  'PutDocumentByIdSortChildren',
  'PutDocumentRootSortChildren',
  'PostDocumentVersionByIdRollback',
  'PutDocumentByIdDomains',
  'PostDocumentByIdPublicAccess',
  'PutDocumentByIdPublicAccess',
  'DeleteDocumentByIdPublicAccess',
])

/**
 * The media writes that go through the media operations (story 165). Each
 * writes its own audit entry and webhook event in the change's transaction; the
 * router still raises their live events and change notices.
 */
export const MEDIA_WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  'PostMedia',
  'PutMediaById',
  'DeleteMediaById',
  'PutMediaByIdMoveToRecycleBin',
  'PutMediaByIdMove',
  'PutMediaSort',
  'PutMediaByIdSortChildren',
  'PutMediaRootSortChildren',
  'PutRecycleBinMediaByIdRestore',
  'DeleteRecycleBinMediaById',
  'DeleteRecycleBinMedia',
])
