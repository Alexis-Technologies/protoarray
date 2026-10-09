# Changelog

All notable changes to **`@alexify/protoarray`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Package scaffold** set up like the other Alexis libraries: plain CommonJS with no build step,
  a hand-written `index.d.ts`, a closed `exports` map with a `browser` entry, and zero runtime
  dependencies.
- **`encode` and `decode` placeholders.** Both throw until the protoarray format is implemented;
  their signatures are provisional.
- **Tooling:** pnpm, oxlint and oxfmt, `node:test` suites with c8 coverage gates, tsd type tests,
  an export-parity check between the runtime and `index.d.ts`, bundle tests through esbuild, a
  bundle-size budget (`pnpm size`) and a zero-dependency benchmark harness (`pnpm bench`).
- **CI** on GitHub Actions and a VitePress documentation site at
  [protoarray.vercel.app](https://protoarray.vercel.app/).

[unreleased]: https://github.com/Alexis-Technologies/protoarray/commits/main
