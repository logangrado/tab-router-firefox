# CI Improvements

## Automated release pipeline

### 1. Conventional commits → version bump type

Use conventional commit messages (`feat:`, `fix:`, `chore:`, etc.) to automatically
determine whether a release is a patch, minor, or major bump.

Borrow the existing logic from the `seekr-hatchery` repo rather than re-implementing it.

### 2. Auto bump version on merge

On merge to `main`, run the version bump automatically:
- Parse commit messages since the last tag to determine bump type
- Run `npm version <patch|minor|major>` (which also updates `src/manifest.json` via the
  `preversion` script and creates the git tag)
- Push the commit and tag back to the repo

### 3. Auto upload extension

On new version tag, build and submit to AMO via `web-ext sign`:
- `AMO_API_KEY` and `AMO_API_SECRET` stored as GitHub Actions secrets
- `--channel=listed` for public releases, `--channel=unlisted` for personal distribution
- See the publishing notes in README for context
