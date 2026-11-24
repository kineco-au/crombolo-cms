import { umbMovedSectionPath } from './moved-sections.js';
import { expect } from '@open-wc/testing';

describe('umbMovedSectionPath', () => {
	it('sends each Bundles view to its tab in Settings, with the rest and the query', () => {
		expect(umbMovedSectionPath('/crombolo/section/packages/view/installed', '?bundle=%40acme%2Fseo')).to.equal(
			'/crombolo/section/settings/dashboard/bundles/installed?bundle=%40acme%2Fseo',
		);
		expect(umbMovedSectionPath('/crombolo/section/packages/view/created/package-builder/edit/abc')).to.equal(
			'/crombolo/section/settings/dashboard/bundles/created/package-builder/edit/abc',
		);
	});

	it('names the marketplace by its tab, and the section alone by the tool', () => {
		expect(umbMovedSectionPath('/umbraco/section/packages/view/packages')).to.equal(
			'/umbraco/section/settings/dashboard/bundles/marketplace',
		);
		expect(umbMovedSectionPath('/umbraco/section/packages')).to.equal('/umbraco/section/settings/dashboard/bundles');
	});

	it('sends Library and Translation under Content, and Approvals out of it (story 419)', () => {
		expect(umbMovedSectionPath('/crombolo/section/library/workspace/element/edit/abc')).to.equal(
			'/crombolo/section/content/library/workspace/element/edit/abc',
		);
		expect(umbMovedSectionPath('/crombolo/section/translation', '?q=1')).to.equal(
			'/crombolo/section/content/translation?q=1',
		);
		expect(umbMovedSectionPath('/crombolo/section/content/approvals/view/list')).to.equal(
			'/crombolo/section/approvals/view/list',
		);
		expect(umbMovedSectionPath('/crombolo/section/workflow')).to.equal('/crombolo/section/approvals');
	});

	it('leaves every other address alone', () => {
		expect(umbMovedSectionPath('/umbraco/section/content')).to.equal(undefined);
		expect(umbMovedSectionPath('/umbraco/section/content/library')).to.equal(undefined);
		expect(umbMovedSectionPath('/umbraco/section/approvals')).to.equal(undefined);
		expect(umbMovedSectionPath('/umbraco/section/packagesish')).to.equal(undefined);
	});
});
