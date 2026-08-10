# Installation

Shelfmark is typically deployed with Docker Compose.

## Quick Start

1. Download the compose file from the repository:

```bash
curl -O https://raw.githubusercontent.com/muneebabbas/shelfmark/main/compose/docker-compose.yml
```

2. Start the service:

```bash
docker compose up -d
```

3. Open `http://localhost:8084`

4. Configure the sources, metadata providers, and delivery settings you want to use

## Next Steps

- For volume and path setup, see [Directory and Volume Setup](configuration.md)
- For environment-based setup, see [Environment Variables](environment-variables.md)
- For creating releases and publishing Docker images, see [Release Process](dev/releasing.md)
- For authentication and user management, see [Users & Requests](users-and-requests.md) and [OIDC](oidc.md)

## Notes

- Universal search is the default mode for new installs
- Direct Download is optional and must be enabled and configured before it can be used
- Torrent and usenet setups require matching download paths between Shelfmark and your download client
- The full and lite images include Calibre's `ebook-convert` utility for AZW3 to EPUB conversion

## AZW3 Conversion

The container provides `/usr/bin/ebook-convert` from Calibre's pinned official Linux binary
bundle. The converter is included in both `shelfmark` and `shelfmark-lite` images and is
intended for authorized, DRM-free inputs only. Conversion should be performed asynchronously
by the application and its output should be validated before it is offered to users.

The image currently pins upstream Calibre `9.13.0` and verifies the architecture-specific
archive with SHA-256 during the Docker build. Updating Calibre requires changing the version
and both checksums in `Dockerfile` together. The Calibre bundle is GPLv3; see its bundled
license files under `/opt/calibre` in the image.
