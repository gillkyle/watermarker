import { useEffect, useRef, useState } from 'react'

export interface BrushCanvasHandle {
  getMask: () => HTMLCanvasElement
  clear: () => void
}

interface Props {
  image: HTMLImageElement
  brushSize: number
  tool: 'brush' | 'eraser'
  /** Called whenever the user finishes a stroke. */
  onChange?: () => void
  /** Imperative handle setter. */
  onReady?: (handle: BrushCanvasHandle) => void
}

/**
 * Two-layer canvas: bottom shows the image, top is a transparent overlay the
 * user paints on. The painted overlay IS the mask — we read it back as the
 * mask canvas for inpainting.
 */
export function BrushCanvas({
  image,
  brushSize,
  tool,
  onChange,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const lastPt = useRef<{ x: number; y: number } | null>(null)
  const [displayScale, setDisplayScale] = useState(1)

  // Size canvases to the image's natural dimensions, then scale via CSS so
  // pointer coordinates map cleanly into image pixel space.
  useEffect(() => {
    const imgC = imageCanvasRef.current
    const maskC = maskCanvasRef.current
    const overC = overlayRef.current
    if (!imgC || !maskC || !overC) return

    const w = image.naturalWidth
    const h = image.naturalHeight
    for (const c of [imgC, maskC, overC]) {
      c.width = w
      c.height = h
    }
    imgC.getContext('2d')!.drawImage(image, 0, 0)
    maskC.getContext('2d')!.clearRect(0, 0, w, h)
    overC.getContext('2d')!.clearRect(0, 0, w, h)
  }, [image])

  // Compute display scale to fit width.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      const containerW = container.clientWidth
      const scale = Math.min(1, containerW / image.naturalWidth)
      setDisplayScale(scale)
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [image])

  // Expose imperative handle.
  useEffect(() => {
    if (!onReady) return
    onReady({
      getMask: () => maskCanvasRef.current!,
      clear: () => {
        const maskC = maskCanvasRef.current!
        const overC = overlayRef.current!
        maskC.getContext('2d')!.clearRect(0, 0, maskC.width, maskC.height)
        overC.getContext('2d')!.clearRect(0, 0, overC.width, overC.height)
        onChange?.()
      },
    })
  }, [onReady, onChange])

  function eventToImagePoint(e: React.PointerEvent): { x: number; y: number } {
    const rect = overlayRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * image.naturalWidth,
      y: ((e.clientY - rect.top) / rect.height) * image.naturalHeight,
    }
  }

  function drawStroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const maskC = maskCanvasRef.current!
    const overC = overlayRef.current!
    const mctx = maskC.getContext('2d')!
    const octx = overC.getContext('2d')!

    const op = tool === 'eraser' ? 'destination-out' : 'source-over'
    for (const ctx of [mctx, octx]) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = brushSize
      ctx.globalCompositeOperation = op
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
    }
    // Mask is white (full alpha) — used for inpaint.
    mctx.strokeStyle = 'rgba(255,255,255,1)'
    mctx.stroke()
    // Overlay is a translucent accent color — what the user sees.
    octx.strokeStyle = 'rgba(79, 140, 255, 0.5)'
    octx.stroke()

    for (const ctx of [mctx, octx]) {
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault()
    overlayRef.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = eventToImagePoint(e)
    lastPt.current = p
    drawStroke(p, p)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawing.current) return
    const p = eventToImagePoint(e)
    drawStroke(lastPt.current!, p)
    lastPt.current = p
  }

  function onPointerUp() {
    if (!drawing.current) return
    drawing.current = false
    lastPt.current = null
    onChange?.()
  }

  const cssW = image.naturalWidth * displayScale
  const cssH = image.naturalHeight * displayScale

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: cssW,
          height: cssH,
          cursor: 'crosshair',
          touchAction: 'none',
          background: '#000',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={imageCanvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
        <canvas
          ref={overlayRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <canvas ref={maskCanvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  )
}
