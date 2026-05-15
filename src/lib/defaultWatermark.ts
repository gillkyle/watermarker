import { urlToImage } from './canvas'

/**
 * Generate a stylized default watermark on a transparent canvas: a heart-on-
 * anchor mark + "Disney Cruise Line" wordmark in italic script.
 *
 * This is a placeholder for users to test the workflow before uploading
 * their actual brand watermark.
 */
export function createDefaultWatermark(): HTMLCanvasElement {
  const w = 1200
  const h = 280
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'

  // Simple ship + heart icon on the left.
  ctx.save()
  ctx.translate(60, 140)
  drawShipIcon(ctx, 180)
  ctx.restore()

  // Wordmark to the right of the icon.
  ctx.save()
  ctx.translate(290, 0)
  ctx.fillStyle = '#000'
  ctx.font = 'italic 700 130px "Brush Script MT", "Lucida Handwriting", "Segoe Script", cursive'
  ctx.textBaseline = 'middle'
  ctx.fillText('Disney Cruise Line', 0, h / 2)
  ctx.restore()

  return canvas
}

function drawShipIcon(ctx: CanvasRenderingContext2D, size: number) {
  // Heart, slightly offset upward.
  ctx.save()
  ctx.translate(0, -size * 0.25)
  ctx.scale(size / 100, size / 100)
  ctx.beginPath()
  ctx.moveTo(0, -20)
  ctx.bezierCurveTo(-30, -50, -55, -20, 0, 25)
  ctx.bezierCurveTo(55, -20, 30, -50, 0, -20)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Stylized ship hull arc.
  ctx.save()
  ctx.translate(0, size * 0.3)
  ctx.lineWidth = size * 0.08
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-size * 0.55, -size * 0.05)
  ctx.quadraticCurveTo(0, size * 0.35, size * 0.55, -size * 0.05)
  ctx.stroke()
  ctx.restore()
}

let cached: HTMLImageElement | null = null
export async function getDefaultWatermarkImage(): Promise<HTMLImageElement> {
  if (cached) return cached
  const canvas = createDefaultWatermark()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  )
  const url = URL.createObjectURL(blob)
  const img = await urlToImage(url)
  cached = img
  return img
}
