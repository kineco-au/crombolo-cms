import type { UmbUserGroupEntityType } from './entity.js';

export type * from './entity.js';
export interface UmbUserGroupDetailModel {
	alias: string;
	aliasCanBeChanged: boolean;
	documentRootAccess: boolean;
	documentStartNode: { unique: string } | null;
	elementRootAccess: boolean;
	elementStartNode: { unique: string } | null;
	entityType: UmbUserGroupEntityType;
	fallbackPermissions: Array<string>;
	hasAccessToAllLanguages: boolean;
	icon: string | null;
	isDeletable: boolean;
	languages: Array<string>;
	mediaRootAccess: boolean;
	mediaStartNode: { unique: string } | null;
	name: string;
	// TODO: add type
	permissions: Array<any>;
	sections: Array<string>;
	unique: string;
	description: string | null;
	// Crombolo: the groups whose members choose who is in this one, and whether the current user is one of them
	owners: Array<{ unique: string }>;
	canManageMembers: boolean;
}
