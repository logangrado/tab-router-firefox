# Task: ci-release

**Status**: complete
**Branch**: hatchery/ci-release
**Created**: 2026-04-12 20:43

## Objective

Set up completely automated CI release for the `tab-router` Firefox extension.

## Context

The addon had no CI/CD at all. Five reference workflow files were pre-authored at
`/repo/.github/workflows/` (untracked). The task was to commit them to the
`hatchery/ci-release` branch and open a PR to `main`.

## Summary

### Files added

All 6 files landed in `.github/`:

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Lint (`eslint` + `web-ext lint`) then test (`jest`) on every PR |
| `.github/workflows/release.yml` | On merge to main: parse conventional commits → semver bump → `npm version` → push tag → GitHub Release → AMO publish |
| `.github/workflows/release-preview.yml` | Posts/updates a PR comment showing predicted next version and changelog preview |
| `.github/workflows/codeql.yml` | CodeQL JavaScript security analysis on push/PR/weekly |
| `.github/workflows/scorecard.yml` | OSSF Scorecard supply-chain security on push/PR/weekly |
| `.github/dependabot.yml` | Dependabot config (was co-located with the workflows) |

### Key decisions

**Conventional commits → semver**: `feat:` → minor, `fix|perf|refactor|revert|test:` → patch,
`<type>!:` → major, `no-bump:` → skip release entirely. Logic is inline bash in the workflow
(no external action dependency).

**preversion hook integration**: `release.yml` runs `npm version <X.Y.Z>` which automatically
triggers `scripts/preversion.js`, keeping `src/manifest.json` in sync with `package.json`.
No changes to the hook were needed.

**pull_request_target for preview**: `release-preview.yml` uses `pull_request_target` (not
`pull_request`) so it has write access to post comments even from fork PRs. The workflow
never executes PR head code, so this is safe.

**Pinned action SHAs**: All `uses:` references are pinned to full commit SHAs for supply-chain
security (satisfies Scorecard requirements).

### Required one-time setup (manual, by repo owner)

Add these secrets in GitHub → Settings → Secrets → Actions:
- `AMO_API_KEY` — from addons.mozilla.org developer credentials
- `AMO_API_SECRET` — same

Without these secrets the `publish-amo` job in `release.yml` will fail. All other workflows
work without secrets.

### Gotcha: branch protection

`release.yml` pushes a version-bump commit and tag directly to `main`. If branch protection
requires PR reviews, this push will be blocked by GITHUB_TOKEN. The workflow includes a comment
explaining this; the fix is to either:
- Enable "Allow GitHub Actions to bypass required reviews" in repo settings, or
- Use a PAT with repo write access instead of GITHUB_TOKEN

### How to push (sandbox had no SSH/HTTPS credentials)

The commit (`417358c`) is local. From the host machine:

```bash
git push origin hatchery/ci-release
gh pr create --title "feat: add automated CI and release workflows" \
  --body "Adds CI, automated release, release preview, CodeQL, and Scorecard workflows. See .github/workflows/ for details." \
  --base main --head hatchery/ci-release
```
