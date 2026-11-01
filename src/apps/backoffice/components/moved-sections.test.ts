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

	it('leaves every other address alone', () => {
		expect(umbMovedSectionPath('/umbraco/section/content')).to.equal(undefined);
		expect(umbMovedSectionPath('/umbraco/section/packagesish')).to.equal(undefined);
	});
});
