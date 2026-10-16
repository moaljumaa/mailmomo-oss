# Releasing (maintainers)

The private development repo is the source of truth; the public repo is a **sanitized, history-free export** of it.
Everything is driven by `publish/publish.sh`:

```bash
bash publish/release.sh patch        # or minor | major | 1.2.3  (add --dry-run first) — the only command to run for a release
bash publish/publish.sh visibility public    # one-time: flip the public repo to public
```

`release` does, in order: preflight (clean tree, branch, `gh` auth, typecheck/lint/unit tests) → bump `package.json` →
prepend `CHANGELOG.md` from commits since the last tag → commit `release: vX.Y.Z` + tag + push (private) →
export tracked files minus `publish/exclude.txt` → **leak scan** against `publish/denylist.txt` (aborts on any hit) →
commit/tag/push to the public repo → create the GitHub Release. Then `publish/docker.sh` builds `linux/amd64`, smoke-tests it (only `BETTER_AUTH_URL`, `MASTER_KEY`, `BETTER_AUTH_SECRET`, `ALLOW_SIGNUP`, read-only rootfs) and pushes `moaljumaa/mailmomo:<version>` + `:latest` to Docker Hub (needs `docker login` once). No GitHub Actions/workflows — everything runs from these scripts. `publish.sh` alone = GitHub only; `docker.sh` alone = re-push the current tagged version.

Config lives in `publish/config.env`. Add anything private to `publish/exclude.txt`; add new private identifiers to `publish/denylist.txt`.
