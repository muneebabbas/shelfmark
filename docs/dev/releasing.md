# Releasing

Releases are published from the `muneebabbas/shelfmark` repository. The
`Create and publish Docker images` workflow runs for every tag matching `v*`.
It builds and pushes both multi-architecture images:

- `ghcr.io/muneebabbas/shelfmark`
- `ghcr.io/muneebabbas/shelfmark-lite`

## Publish the Latest Main Build

To publish the current `main` build immediately without creating a release,
manually dispatch the Docker workflow after updating `main`:

```bash
git switch main
git pull --ff-only
gh workflow run build-and-publish-docker-image.yml --ref main
```

Track the dispatched run from the Actions page or with:

```bash
gh run list --workflow build-and-publish-docker-image.yml --event workflow_dispatch --limit 1
gh run watch RUN_ID --exit-status
```

The resulting multi-architecture images are tagged `dev` and with the commit
SHA. For the current development image, use:

```bash
ghcr.io/muneebabbas/shelfmark:dev
ghcr.io/muneebabbas/shelfmark-lite:dev
```

Verify the published manifests with:

```bash
docker manifest inspect ghcr.io/muneebabbas/shelfmark:dev
docker manifest inspect ghcr.io/muneebabbas/shelfmark-lite:dev
```

This workflow publishes to GitHub Container Registry (GHCR), not Docker Hub.
The `dev` tag is mutable and is intended for the latest non-release build.

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
