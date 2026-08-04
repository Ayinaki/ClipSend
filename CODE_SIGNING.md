# Code Signing Policy

**Status:** Draft — submitted for approval with the SignPath Foundation application.

## Overview

ClipSend is a Windows desktop application packaged with `electron-builder` as an
NSIS installer (`ClipSend.Setup.<version>.exe`). Release builds are code-signed
so Windows can verify the publisher and so the in-app auto-updater
(`electron-updater`) can validate downloaded updates before applying them.

Code signing infrastructure is provided by the **SignPath Foundation** for free
as part of its open-source program. The Foundation holds the code signing
certificate and its private key in a FIPS-compliant Hardware Security Module
(HSM); the project never has access to the private key and cannot export it.

## Attribution

This project uses free code signing provided by SignPath.io, certificate by
SignPath Foundation:

> Free code signing provided by [SignPath.io](https://signpath.io), certificate
> by [SignPath Foundation](https://signpath.org).

## Privacy Policy

See [PRIVACY.md](PRIVACY.md).

## Build Pipeline

All release artifacts are built automatically by GitHub Actions from the public
repository — never on maintainer machines — so the origin of every signed
binary can be verified against the tagged source.

1. A maintainer pushes a version tag `vX.Y.Z` to `main`.
2. The [Release Build workflow](.github/workflows/release.yml) runs on a
   `windows-latest` runner and:
   - Checks out the tagged source with full history (`actions/checkout@v4`).
   - Installs pinned dependencies (`npm ci`).
   - Downloads the pinned FFmpeg / FFprobe and Gifski binaries into `bin/`.
   - Runs the unit test suite (`npm test`).
   - Builds the app with `electron-builder` (`npm run build`), producing
     `dist/ClipSend.Setup.<version>.exe` together with its `.blockmap` and
     `latest.yml` update metadata.
3. The installer is submitted to the SignPath Foundation signing service, and
   the signed artifact is published as a GitHub Release.

## Roles

SignPath's model distinguishes Authors, Reviewers, and Approvers. ClipSend is
maintained by a single maintainer, so all three roles are currently held by the
same person:

| Role      | Description                                        | Holder  |
|-----------|----------------------------------------------------|---------|
| Author    | Writes code and pushes branches.                   | Ayinaki |
| Reviewer  | Reviews changes before they reach `main`.          | Ayinaki |
| Approver  | Approves the final release build for signing.      | Ayinaki |

Mitigations for this role concentration:

- All changes to `main` must go through a pull request.
- CI ("Build & Test (Windows)") must pass before a PR is merged.
- Releases are only created from version tags pushed to `main`.
- The signing private key is held exclusively by the SignPath Foundation HSM
  and can never be exported or accessed by the project.

## What Gets Signed

- `ClipSend.Setup.<version>.exe` — the NSIS installer distributed via GitHub
  Releases and consumed by the in-app auto-updater.
- Once signing is live, the auto-updater will be configured to verify the
  installer's signature against the expected publisher before applying
  updates, rejecting any artifact that does not match.

## Approval Process

SignPath Foundation reviewers verify that this repository is public, uses an
OSI-approved license ([ISC](LICENSE)), builds automatically in CI, and complies
with this policy before approving signing requests.
