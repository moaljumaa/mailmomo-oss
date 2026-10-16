# Releasing (maintainers)

The private development repo is the source of truth; the public repo is a **sanitized, history-free export** of it.
Everything is driven by `publish/publish.sh`:

```bash
bash publish/publish.sh release patch        # or minor | major | 1.2.3  (add --dry-run first)
bash publish/publish.sh visibility public    # one-time: flip the public repo to public
```

`release` does, in order: preflight (clean tree, branch, `gh` auth, typecheck/lint/unit tests) → bump `package.json` →
prepend `CHANGELOG.md` from commits since the last tag → commit `release: vX.Y.Z` + tag + push (private) →
export tracked files minus `publish/exclude.txt` → **leak scan** against `publish/denylist.txt` (aborts on any hit) →
commit/tag/push to the public repo → create the GitHub Release. The tag triggers `.github/workflows/release.yml`, which pushes the Docker image to GHCR.

Config lives in `publish/config.env`. Add anything private to `publish/exclude.txt`; add new private identifiers to `publish/denylist.txt`.
