import { urlToImage } from './canvas'

/**
 * Default watermark used when the user hasn't uploaded one yet. Sourced from
 * /public/default-watermark.svg (white wordmark + ship/heart icon, transparent
 * background). Falls back to a canvas-rendered version if the asset fails to
 * load.
 *
 * To replace with your real brand mark, drop a transparent PNG at
 *   public/default-watermark.svg
 * (or change DEFAULT_WATERMARK_URL to point at a different filename).
 */
export const DEFAULT_WATERMARK_URL = '/default-watermark.svg'

let cached: HTMLImageElement | null = null

export async function getDefaultWatermarkImage(): Promise<HTMLImageElement> {
  if (cached) return cached
  try {
    const img = await urlToImage(DEFAULT_WATERMARK_URL)
    cached = img
    return img
  } catch {
    // Asset missing — synthesize one at runtime so the UI still works.
    const canvas = createWhiteWatermarkCanvas()
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/png',
      ),
    )
    const url = URL.createObjectURL(blob)
    const img = await urlToImage(url)
    cached = img
    return img
  }
}

function createWhiteWatermarkCanvas(): HTMLCanvasElement {
  const w = 1200
  const h = 280
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'

  // Heart icon.
  ctx.save()
  ctx.translate(110, 110)
  ctx.beginPath()
  ctx.moveTo(0, -12)
  ctx.bezierCurveTo(-26, -44, -56, -22, 0, 30)
  ctx.bezierCurveTo(56, -22, 26, -44, 0, -12)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Ship hull arc.
  ctx.save()
  ctx.translate(110, 175)
  ctx.lineWidth = 14
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-70, -4)
  ctx.quadraticCurveTo(0, 42, 70, -4)
  ctx.stroke()
  ctx.restore()

  // Wordmark.
  ctx.fillStyle = '#fff'
  ctx.font =
    'italic 700 130px "Brush Script MT", "Lucida Handwriting", "Segoe Script", "Apple Chancery", cursive'
  ctx.textBaseline = 'middle'
  ctx.fillText('Disney Cruise Line', 240, h / 2 + 10)

  return canvas
}
