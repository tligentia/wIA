# Versioning and GitHub Releases

AnonimAE uses a unified numeric version in the format:

```text
YY.M.PATCH
```

Example:

```text
26.6.41
```

The same version must be present in:

- `package.json`
- `src/extension/manifest.json`
- `src/extension/manifest.json` `version_name`
- `extension/manifest.json`
- `extension/manifest.json` `version_name`

## Daily Development Flow

Use the repository's packaging script when a release-relevant change touches source, rules, frontend, or extension files:

```bash
npm run package-extension
```

This script increments the version, syncs the extension manifests, compiles `config/rules.yaml`, refreshes `src/frontend`, and rebuilds the loadable `extension/` folder.

For documentation-only or CI-only changes, do not run `npm run package-extension` unless you intentionally want a new product version.

## Local Checks

Run:

```bash
npm run check:version
npm test
```

`check:version` prevents publishing a mismatch between the package version and browser extension manifests.

## GitHub CI

GitHub Actions runs on pushes and pull requests to `main`:

- dependency install with pnpm
- version consistency check
- JavaScript syntax checks
- offline integration test suite

## Creating a GitHub Release

After merging a release-ready commit into `main`, create a tag that matches `package.json`:

```bash
VERSION="$(node -p "require('./package.json').version")"
git tag "v${VERSION}"
git push origin "v${VERSION}"
```

The `Release` GitHub Action validates the tag, runs the test suite, zips the `extension/` folder, and publishes a GitHub Release with the packaged browser extension artifact.

## Current Release

Current project version: `26.6.41`.
