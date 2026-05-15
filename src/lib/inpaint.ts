import * as ort from 'onnxruntime-web'
import { cloneCanvas } from './canvas'

// Load ORT WASM artifacts from a CDN matching the installed package version.
// This avoids needing to copy them into /public.
ort.env.wasm.wasmPaths =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/'

/**
 * Default model: LaMa exported to ONNX by Carve. ~200MB.
 *   https://huggingface.co/Carve/LaMa-ONNX
 *
 * The model has two inputs ("image", "mask") and one output, all float32
 * NCHW, range [0, 1]. Dimensions are dynamic but must be divisible by 8.
 *
 * Hugging Face's CDN sets permissive CORS, so the browser can fetch this
 * directly. First load caches in the browser; subsequent loads are instant.
 */
export const DEFAULT_MODEL_URL =
  'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx'

/**
 * Max longest-edge dimension passed to the model. Larger images are
 * downscaled before inference and the inpainted region is upscaled and
 * pasted back. Keeps memory bounded across the variety of raw sizes.
 */
const MAX_INFERENCE_SIZE = 1024

let cachedSession: { url: string; session: ort.InferenceSession } | null = null

export type ProgressCb = (info: { phase: string; progress?: number }) => void

export async function loadModel(
  url: string = DEFAULT_MODEL_URL,
  onProgress?: ProgressCb,
): Promise<ort.InferenceSession> {
  if (cachedSession && cachedSession.url === url) {
    return cachedSession.session
  }

  onProgress?.({ phase: 'Downloading model', progress: 0 })
  const buf = await fetchWithProgress(url, (loaded, total) => {
    onProgress?.({
      phase: 'Downloading model',
      progress: total ? loaded / total : undefined,
    })
  })

  onProgress?.({ phase: 'Initializing runtime' })
  const session = await ort.InferenceSession.create(buf, {
    executionProviders: ['webgpu', 'wasm'],
    graphOptimizationLevel: 'all',
  })

  cachedSession = { url, session }
  onProgress?.({ phase: 'Ready' })
  return session
}

async function fetchWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch model: ${res.status} ${res.statusText}`)
  }
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress(loaded, total)
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out.buffer
}

export interface InpaintInput {
  /** Source image canvas. */
  image: HTMLCanvasElement
  /** Mask canvas — same size as image. White (or alpha > 0) = inpaint. */
  mask: HTMLCanvasElement
  /** Optional override model URL. */
  modelUrl?: string
  onProgress?: ProgressCb
}

/**
 * Inpaint the masked region of an image. Preserves non-masked pixels exactly
 * by pasting the model output only inside the mask.
 */
export async function inpaint({
  image,
  mask,
  modelUrl,
  onProgress,
}: InpaintInput): Promise<HTMLCanvasElement> {
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new Error('Image and mask must have the same dimensions')
  }

  const session = await loadModel(modelUrl, onProgress)

  // 1. Compute crop around the masked region (with padding) to localize work.
  const bbox = computeMaskBBox(mask)
  if (!bbox) {
    return cloneCanvas(image) // nothing to inpaint
  }

  // Pad by 25% of bbox extent on each side, clamped to image.
  const padX = Math.round(bbox.w * 0.25)
  const padY = Math.round(bbox.h * 0.25)
  const cropX = Math.max(0, bbox.x - padX)
  const cropY = Math.max(0, bbox.y - padY)
  const cropX2 = Math.min(image.width, bbox.x + bbox.w + padX)
  const cropY2 = Math.min(image.height, bbox.y + bbox.h + padY)
  const cropW = cropX2 - cropX
  const cropH = cropY2 - cropY

  // 2. Extract cropped image + mask onto inference canvases.
  const cropImg = extractCrop(image, cropX, cropY, cropW, cropH)
  const cropMask = extractCrop(mask, cropX, cropY, cropW, cropH)

  // 3. Resize down if too large for the model.
  const scale = Math.min(1, MAX_INFERENCE_SIZE / Math.max(cropW, cropH))
  let infW = Math.max(8, Math.round(cropW * scale))
  let infH = Math.max(8, Math.round(cropH * scale))
  // Align to 8 (LaMa requirement).
  infW = Math.ceil(infW / 8) * 8
  infH = Math.ceil(infH / 8) * 8

  const infImg = resizeCanvas(cropImg, infW, infH)
  const infMask = resizeCanvas(cropMask, infW, infH)

  // 4. Build tensors.
  onProgress?.({ phase: 'Running inpainting' })
  const imageTensor = canvasToImageTensor(infImg)
  const maskTensor = canvasToMaskTensor(infMask)

  // 5. Run model. Input names vary across exports; try the common ones.
  const feeds = pickFeedNames(session, imageTensor, maskTensor)
  const output = await session.run(feeds)
  const outName = session.outputNames[0]
  const outTensor = output[outName]
  if (!outTensor) throw new Error('Model produced no output')

  // 6. Convert output tensor back to canvas, resize up, and paste into a copy
  //    of the original image (only inside the mask).
  const infOut = tensorToCanvas(outTensor, infW, infH)
  const cropOut = resizeCanvas(infOut, cropW, cropH)
  const result = cloneCanvas(image)
  pasteMasked(result, cropOut, cropMask, cropX, cropY)

  return result
}

function pickFeedNames(
  session: ort.InferenceSession,
  imageTensor: ort.Tensor,
  maskTensor: ort.Tensor,
): Record<string, ort.Tensor> {
  const inputs = session.inputNames
  // LaMa: "image" + "mask". Fallback to first/second by index if names differ.
  const imgKey = inputs.find((n) => /image|img|input/i.test(n)) ?? inputs[0]
  const maskKey = inputs.find((n) => /mask/i.test(n)) ?? inputs[1] ?? inputs[0]
  if (imgKey === maskKey) {
    throw new Error(
      `Could not distinguish image/mask inputs from: ${inputs.join(', ')}`,
    )
  }
  return { [imgKey]: imageTensor, [maskKey]: maskTensor }
}

interface BBox {
  x: number
  y: number
  w: number
  h: number
}
function computeMaskBBox(mask: HTMLCanvasElement): BBox | null {
  const ctx = mask.getContext('2d')!
  const { data, width, height } = ctx.getImageData(0, 0, mask.width, mask.height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      // Use any non-zero RGB or alpha as "masked".
      const v = Math.max(data[idx], data[idx + 1], data[idx + 2], data[idx + 3])
      if (v > 8) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function extractCrop(
  src: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h)
  return out
}

function resizeCanvas(
  src: HTMLCanvasElement,
  w: number,
  h: number,
): HTMLCanvasElement {
  if (src.width === w && src.height === h) return src
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return out
}

function canvasToImageTensor(canvas: HTMLCanvasElement): ort.Tensor {
  const { width, height } = canvas
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
  const out = new Float32Array(3 * width * height)
  const planeSize = width * height
  for (let i = 0; i < planeSize; i++) {
    out[i] = data[i * 4] / 255 // R
    out[i + planeSize] = data[i * 4 + 1] / 255 // G
    out[i + 2 * planeSize] = data[i * 4 + 2] / 255 // B
  }
  return new ort.Tensor('float32', out, [1, 3, height, width])
}

function canvasToMaskTensor(canvas: HTMLCanvasElement): ort.Tensor {
  const { width, height } = canvas
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
  const out = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    // Treat any non-zero R/G/B/A as masked.
    const v = Math.max(
      data[i * 4],
      data[i * 4 + 1],
      data[i * 4 + 2],
      data[i * 4 + 3],
    )
    out[i] = v > 8 ? 1 : 0
  }
  return new ort.Tensor('float32', out, [1, 1, height, width])
}

function tensorToCanvas(
  tensor: ort.Tensor,
  width: number,
  height: number,
): HTMLCanvasElement {
  const data = tensor.data as Float32Array
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(width, height)
  const planeSize = width * height
  // Output may be in [0, 1] or [0, 255]; auto-detect by checking max.
  let max = 0
  for (let i = 0; i < data.length; i++) {
    if (data[i] > max) max = data[i]
  }
  const scale = max > 2 ? 1 : 255
  for (let i = 0; i < planeSize; i++) {
    img.data[i * 4] = clamp8(data[i] * scale)
    img.data[i * 4 + 1] = clamp8(data[i + planeSize] * scale)
    img.data[i * 4 + 2] = clamp8(data[i + 2 * planeSize] * scale)
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return out
}

function pasteMasked(
  dst: HTMLCanvasElement,
  src: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  ox: number,
  oy: number,
) {
  // Mask src by the mask alpha, then draw the result onto dst at offset.
  // Implementation: render src into a temp canvas, then composite the mask
  // using destination-in so only masked pixels survive, then draw onto dst.
  const w = src.width
  const h = src.height
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tctx = tmp.getContext('2d')!
  tctx.drawImage(src, 0, 0)

  // Build an alpha-only mask: white (alpha=1) where masked.
  const maskCtx = mask.getContext('2d')!
  const md = maskCtx.getImageData(0, 0, w, h)
  const alpha = tctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(
      md.data[i * 4],
      md.data[i * 4 + 1],
      md.data[i * 4 + 2],
      md.data[i * 4 + 3],
    )
    alpha.data[i * 4] = 255
    alpha.data[i * 4 + 1] = 255
    alpha.data[i * 4 + 2] = 255
    alpha.data[i * 4 + 3] = v > 8 ? 255 : 0
  }
  const alphaCanvas = document.createElement('canvas')
  alphaCanvas.width = w
  alphaCanvas.height = h
  alphaCanvas.getContext('2d')!.putImageData(alpha, 0, 0)

  tctx.globalCompositeOperation = 'destination-in'
  tctx.drawImage(alphaCanvas, 0, 0)
  tctx.globalCompositeOperation = 'source-over'

  dst.getContext('2d')!.drawImage(tmp, ox, oy)
}

function clamp8(v: number): number {
  if (v < 0) return 0
  if (v > 255) return 255
  return v | 0
}
