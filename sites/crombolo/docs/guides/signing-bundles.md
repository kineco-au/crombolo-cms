---
title: Signing bundles
summary: Sign a bundle in GitHub Actions from the commit or tag it was built at, and choose which bundles a site takes.
order: 11
---

A signed bundle says where it was built: the repository, the commit, and the tag or branch, checked against Sigstore's public log. Signing is optional. A site takes unsigned bundles unless you tell it not to.

## Signing in GitHub Actions

The job needs permission to ask GitHub for its identity. Nothing else is set up: there are no keys to keep.

```yaml
name: Release the bundle
on:
    push:
        tags: ["v*"]
jobs:
    bundle:
        runs-on: ubuntu-latest
        permissions:
            contents: read
            id-token: write
        steps:
            - uses: actions/checkout@v5
            - uses: oven-sh/setup-bun@v2
            - run: bun install --frozen-lockfile
            - run: bunx crombolo site build --out dist/acme-bundle --sign
            - run: npm publish dist/acme-bundle
              env:
                  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

`crombolo bundle sign <dir|tgz>` signs a bundle built or packed some other way. Sign last: a bundle changed after it was signed is refused.

## Checking one

```sh
bunx crombolo bundle verify ./acme-bundle-1.2.0.tgz
bunx crombolo bundle verify @acme/crm@1.2.0 --require --source "acme/*"
```

It prints what a site would show, *Signed: built from github.com/acme/crm at v1.2.0 (abc1234)* or *Not signed*, and exits with an error when the site would refuse it.

A signature says where a bundle was built. It does not say anyone reviewed the code.

### From a private repository

Every signature is kept in a public log, and it names the repository, the workflow file, the tag or branch and the commit. Your code and the bundle are not published. Because the names are, `bundle sign` stops in a private repository unless you add `--public-log`:

```sh
bunx crombolo bundle sign dist/acme-bundle --public-log
```

## What a site takes

| Setting | |
| --- | --- |
| `CROMBOLO_BUNDLE_SIGNATURES` | `optional` (the default), or `required` to refuse unsigned bundles |
| `CROMBOLO_BUNDLE_SOURCES` | where signed bundles must come from: `acme/*`, `acme/crm`, or `acme/crm@v*` for its release tags |

A bundle whose signature does not check out is always refused. The Marketplace's install panel and **Settings → Bundles → Installed** show whether each bundle is signed and where it was built.

## Crombolo's own bundles

Every Crombolo release signs its bundles from its tag: the Redirects and Microsoft Entra bundles on npm, and each demo site, attached to the [GitHub release](https://github.com/kineco-au/crombolo-cms/releases) as a bundle such as `demo-harbourstone-<version>.tgz`:

```sh
bunx crombolo bundle verify https://github.com/kineco-au/crombolo-cms/releases/download/v0.45.0/demo-harbourstone-0.45.0.tgz
bunx crombolo start --bundle ./demo-harbourstone-0.45.0.tgz --publish
```

To take only Crombolo's bundles, set `CROMBOLO_BUNDLE_SOURCES=kineco-au/crombolo-cms@v*`.
