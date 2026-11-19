# Changelog

All notable changes to Opengravity are documented here.

## [0.2.0] — 2026-11-19

### Added

- In-app updates from GitHub Releases (`electron-updater`).
- Manual update checks in **Settings › Application › Updates**.
- Background checks at startup and every six hours.
- Download progress, checksum verification, and restart-to-install flow.
- Portable-build detection with a link to the latest release.
- `Ctrl/Cmd+F` find-in-page for the built-in browser.
- Basic R syntax highlighting for `.r` files.
- Nord dark theme preset.
- Settings opens at the top instead of keeping the previous scroll position.
- Nord surfaces: composer, segmented controls and editor tabs no longer keep the dark palette.
- `/btw` side questions in a floating panel, without touching the thread or tools.
- Read-only GitHub pull request list in Overview → Review (public repos; `GITHUB_TOKEN` for private).
- Audio and PDF viewer in the editor pane (up to 50 MB).
- Dynamic workflows validate `workflow.json` args schemas and honor `WorkflowWaitMillis`.
- SSH remote: terminal, SFTP file browser, remote editor save and optional host fingerprint pinning.
- Remote project mirror: agent, LSP, index and git run locally; changes upload over SFTP.
- Direct remote project: SSHFS-Win mount, writable remote files, remote `run_command` and remote tests.
- Update configuration for GitHub Releases, including `latest.yml` and
  `.blockmap` artifacts.

### Changed

- The Windows release build no longer attempts to publish implicitly; releases
  are published explicitly.
- Version bumped to **0.2.0**.

### Fixed

- Workspace rule files saved with a UTF-8 BOM no longer inject U+FEFF into the
  system prompt.
- Checksum verification rejects a downloaded installer whose SHA-256 does not
  match the published `SHA256SUMS.txt`.

### Notes

- Windows builds are not code-signed. SmartScreen may show “unknown publisher”.
- Portable builds do not self-update; use the linked GitHub release.
- No telemetry is sent by the updater.

## [0.1.0] — 2026-11-18

Initial public release: multi-provider agent engine, Monaco editor, LSP,
terminal, git, MCP, project selector, bilingual UI and Windows packaging.
