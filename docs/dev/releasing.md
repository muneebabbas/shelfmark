# Releasing

Releases are published from the `muneebabbas/shelfmark` repository. The
`Create and publish Docker images` workflow runs for every tag matching `v*`.
It builds and pushes both multi-architecture images:

- `ghcr.io/muneebabbas/shelfmark`
- `ghcr.io/muneebabbas/shelfmark-lite`

For a release, update `main`, create an annotated version tag, and push it:

```bash
git switch main
git pull --ff-only
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --generate-notes
```

The tag workflow publishes `latest`, `X.Y.Z`, `X.Y`, `vX.Y.Z`, and an
immutable SHA tag for each image. Wait for the workflow to finish before
announcing the release. Verify the images with:

```bash
docker manifest inspect ghcr.io/muneebabbas/shelfmark:vX.Y.Z
docker manifest inspect ghcr.io/muneebabbas/shelfmark-lite:vX.Y.Z
```

The workflow requires the repository's `GITHUB_TOKEN` to have package write
and artifact attestation permissions. Manual runs and scheduled runs also
publish images, but only a `v*` tag publishes release and `latest` tags.
