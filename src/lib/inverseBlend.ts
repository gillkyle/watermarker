import { cloneCanvas, imageToCanvas } from './canvas'
import type { Anchor, WatermarkOptions } from './compositor'

/**
 * Mathematically invert standard alpha compositing.
 *
 * Forward: out = base * (1 - alpha_eff) + wm_rgb * alpha_eff
 *   where alpha_eff = wm_alpha * opacity (both in 0..1)
 *
 * Inverse: base = (out - wm_rgb * alpha_eff) / (1 - alpha_eff)
 *
 * Caveats:
 *  - Only applies where alpha_eff < 1. We cap it to avoid div-by-zero so fully
 *    opaque pixels are not recoverable (we leave them at the composite value).
 *  - JPEG recompression after watermarking introduces noise that makes this
 *    approximate rather than exact; results are still typically very good.
 *  - All inputs must be in the same coordinate space (we pre-render the
 *    watermark at the same rect used to apply it).
 */
export interface InverseBlendInput {
  /** The watermarked image to recover. */
  watermarked: HTMLImageElement | HTMLCanvasElement
  /** The watermark PNG (with alpha) that was applied. */
  watermark: HTMLImageElement | HTMLCanvasElement
  /** The exact compositing options used when the watermark was applied. */
  options: WatermarkOptions
}

export function inverseBlend(input: InverseBlendInput): HTMLCanvasElement {
  const baseCanvas = imageToCanvas(input.watermarked)
  const ctx = baseCanvas.getContext('2d')!
  const baseW = baseCanvas.width
  const baseH = baseCanvas.height

  // Render the watermark layer into its own canvas at the same size + rect as
  // the original composite. We use globalAlpha = options.opacity, exactly as in
  // the apply path, so the resulting RGBA already encodes alpha_eff per pixel.
  const wmLayer = renderWatermarkLayer(
    input.watermark,
    input.options,
    baseW,
    baseH,
  )

  const baseData = ctx.getImageData(0, 0, baseW, baseH)
  const wmData = wmLayer.getContext('2d')!.getImageData(0, 0, baseW, baseH)
  const out = ctx.createImageData(baseW, baseH)

  const b = baseData.data
  const w = wmData.data
  const o = out.data

  for (let i = 0; i < b.length; i += 4) {
    // alpha_eff comes from the rendered watermark layer's alpha channel.
    const ae = w[i + 3] / 255
    if (ae <= 0.001) {
      // No watermark contribution; pass through.
      o[i] = b[i]
      o[i + 1] = b[i + 1]
      o[i + 2] = b[i + 2]
      o[i + 3] = 255
      continue
    }
    if (ae >= 0.999) {
      // Fully opaque watermark — original base is unrecoverable. Leave the
      // composite value rather than producing NaN.
      o[i] = b[i]
      o[i + 1] = b[i + 1]
      o[i + 2] = b[i + 2]
      o[i + 3] = 255
      continue
    }

    // The watermark layer is non-premultiplied (canvas getImageData is
    // straight-alpha), so wm_rgb is exactly w[i..i+2].
    const inv = 1 / (1 - ae)
    const r = (b[i] - w[i] * ae) * inv
    const g = (b[i + 1] - w[i + 1] * ae) * inv
    const bl = (b[i + 2] - w[i + 2] * ae) * inv

    o[i] = clamp8(r)
    o[i + 1] = clamp8(g)
    o[i + 2] = clamp8(bl)
    o[i + 3] = 255
  }

  const result = cloneCanvas(baseCanvas)
  result.getContext('2d')!.putImageData(out, 0, 0)
  return result
}

function clamp8(v: number): number {
  if (v < 0) return 0
  if (v > 255) return 255
  return v | 0
}

function renderWatermarkLayer(
  watermark: HTMLImageElement | HTMLCanvasElement,
  options: WatermarkOptions,
  baseW: number,
  baseH: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = baseW
  canvas.height = baseH
  const ctx = canvas.getContext('2d')!

  const wmNaturalW =
    'naturalWidth' in watermark ? watermark.naturalWidth : watermark.width
  const wmNaturalH =
    'naturalHeight' in watermark ? watermark.naturalHeight : watermark.height
  const shorter = Math.min(baseW, baseH)
  const targetW = Math.round(shorter * options.scale)
  const targetH = Math.round((targetW / wmNaturalW) * wmNaturalH)
  const marginPx = Math.round(shorter * options.margin)
  const { x, y } = positionFromAnchor(
    options.anchor,
    baseW,
    baseH,
    targetW,
    targetH,
    marginPx,
  )

  ctx.save()
  ctx.globalAlpha = options.opacity

  if (options.tile) {
    const tile = document.createElement('canvas')
    tile.width = targetW
    tile.height = targetH
    tile.getContext('2d')!.drawImage(watermark, 0, 0, targetW, targetH)
    const pattern = ctx.createPattern(tile, 'repeat')!
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, baseW, baseH)
  } else if (options.rotation && options.rotation !== 0) {
    ctx.translate(x + targetW / 2, y + targetH / 2)
    ctx.rotate((options.rotation * Math.PI) / 180)
    ctx.drawImage(watermark, -targetW / 2, -targetH / 2, targetW, targetH)
  } else {
    ctx.drawImage(watermark, x, y, targetW, targetH)
  }
  ctx.restore()

  return canvas
}

function positionFromAnchor(
  anchor: Anchor,
  baseW: number,
  baseH: number,
  w: number,
  h: number,
  margin: number,
): { x: number; y: number } {
  let x = 0
  let y = 0
  if (anchor.endsWith('left')) x = margin
  else if (anchor.endsWith('center')) x = (baseW - w) / 2
  else if (anchor.endsWith('right')) x = baseW - w - margin

  if (anchor.startsWith('top')) y = margin
  else if (anchor.startsWith('middle')) y = (baseH - h) / 2
  else if (anchor.startsWith('bottom')) y = baseH - h - margin

  return { x: Math.round(x), y: Math.round(y) }
}
