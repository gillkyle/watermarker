import { imageToCanvas } from './canvas'

export type Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface WatermarkOptions {
  /** 0..1 */
  opacity: number
  /** Watermark size as a fraction of the base image's shorter side. 0..1 */
  scale: number
  /** Margin from the anchor edge, as fraction of the shorter side. 0..0.5 */
  margin: number
  /** Anchor position. */
  anchor: Anchor
  /** Optional rotation in degrees. */
  rotation?: number
  /** If true, tile the watermark across the full image instead of anchoring. */
  tile?: boolean
}

export interface CompositeResult {
  canvas: HTMLCanvasElement
  /** The actual destination rectangle of the watermark in image pixels. */
  rect: { x: number; y: number; width: number; height: number }
}

/**
 * Composite a watermark image onto a base image using standard alpha blending.
 * Returns a new canvas with the result plus the destination rect (useful for
 * inverse-blend later).
 */
export function applyWatermark(
  base: HTMLImageElement | HTMLCanvasElement,
  watermark: HTMLImageElement | HTMLCanvasElement,
  options: WatermarkOptions,
): CompositeResult {
  const canvas = imageToCanvas(base)
  const ctx = canvas.getContext('2d')!

  const baseW = canvas.width
  const baseH = canvas.height
  const wmNaturalW = 'naturalWidth' in watermark ? watermark.naturalWidth : watermark.width
  const wmNaturalH = 'naturalHeight' in watermark ? watermark.naturalHeight : watermark.height

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
    // Build a single-tile canvas to use as a pattern source so opacity applies.
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

  return {
    canvas,
    rect: { x, y, width: targetW, height: targetH },
  }
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
