# Runtime assets for packaging

Place production runtime assets in this folder before running `npm run package`:

- `runtime/whisper-runtime/`: whisper.cpp binaries and required shared libraries.
- `runtime/whisper-models/`: model files such as `ggml-base.bin`.

The Electron packager copies these folders into `process.resourcesPath`:

- `resources/whisper-runtime`
- `resources/whisper-models`

In development, the app also checks these same folders first, then falls back to `node_modules` paths when available.
