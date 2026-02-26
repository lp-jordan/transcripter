# App icon files

Provide your own OS-level app icon files in this folder using these exact names:

- `build/icons/icon.png`
- `build/icons/icon.ico`

The `electron-builder` config in `package.json` points to those paths.

## What each file is for

- `icon.png`: default icon used for general/macOS/Linux packaging.
- `icon.ico`: Windows icon used for Windows packaging (`nsis`, `portable`).

## Why both formats?

- PNG is a standard raster format used broadly across platforms.
- ICO is a Windows-native icon container that can embed multiple resolutions in one file.

## Recommended source assets

- Start from a square high-resolution source image (at least `512x512`, ideally `1024x1024`).
- Export `icon.png`.
- Generate `icon.ico` with multiple embedded sizes (commonly 16, 24, 32, 48, 64, 128, 256).

## Packaging

Once you add your own icon files, run:

- `npm run package`
- or platform-specific: `npm run package:mac` / `npm run package:win`
