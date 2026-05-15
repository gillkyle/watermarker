# Watermarker

Browser-only tool for applying and removing watermarks on photography. Built for the case of recovering raw versions of photos where only the watermarked delivery copies remain (e.g. Disney Cruise Line raws).

## Modes

### Apply
Composite a watermark (PNG with transparency) over an image using configurable opacity, scale, anchor, margin, rotation, and optional tiling. Pure Canvas — runs instantly client-side.

### Remove
Two methods:

- **Paint mask (AI)** — paint over the watermark with the brush, then a LaMa inpainting model (ONNX, ~200MB, cached after first load) fills the region. Works on any watermark. The model runs entirely in the browser via `onnxruntime-web` (WebGPU when available, WASM fallback).
- **Known watermark (math)** — when you have the original watermark PNG and know the blend params used to apply it, we mathematically invert alpha compositing: `base = (out − wm × αₑ) / (1 − αₑ)`. Instant, near-perfect when the image hasn't been heavily recompressed.

The brush flow runs inference on a cropped, downscaled region around the mask and pastes the result back into the full-resolution original, so non-masked pixels are preserved exactly.

## Develop

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
npm run preview
```

## Default watermark

A canvas-generated placeholder ("Disney Cruise Line" wordmark, black, no background) is built in for demo purposes. Replace with your actual watermark PNG via the "Choose watermark PNG" button.
