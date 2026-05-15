import { useEffect, useMemo, useRef, useState } from 'react'
import { BrushCanvas, type BrushCanvasHandle } from './BrushCanvas'
import {
  canvasToBlob,
  downloadBlob,
  fileToImage,
  imageToCanvas,
  styleResultCanvas,
} from '../lib/canvas'
import { DEFAULT_MODEL_URL, inpaint, type ProgressCb } from '../lib/inpaint'
import { inverseBlend } from '../lib/inverseBlend'
import type { Anchor, WatermarkOptions } from '../lib/compositor'
import { getDefaultWatermarkImage } from '../lib/defaultWatermark'

type Method = 'brush' | 'known'

const ANCHORS: Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

export function RemoveMode() {
  const [method, setMethod] = useState<Method>('brush')
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null)
  const [baseName, setBaseName] = useState('image')
  const [result, setResult] = useState<HTMLCanvasElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; progress?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Brush state
  const brushRef = useRef<BrushCanvasHandle | null>(null)
  const [brushSize, setBrushSize] = useState(80)
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [modelUrl, setModelUrl] = useState<string>(DEFAULT_MODEL_URL)

  // Known-watermark state
  const [watermark, setWatermark] = useState<HTMLImageElement | null>(null)
  const [usingDefaultWm, setUsingDefaultWm] = useState(true)
  const [wmOptions, setWmOptions] = useState<WatermarkOptions>({
    opacity: 0.4,
    scale: 0.35,
    margin: 0.025,
    anchor: 'bottom-right',
    rotation: 0,
    tile: false,
  })

  useEffect(() => {
    if (watermark) return
    getDefaultWatermarkImage().then(setWatermark)
  }, [watermark])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBaseName(file.name.replace(/\.[^.]+$/, ''))
    const img = await fileToImage(file)
    setBaseImage(img)
    setResult(null)
    setError(null)
  }

  async function handleWatermarkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const img = await fileToImage(file)
    setWatermark(img)
    setUsingDefaultWm(false)
  }

  async function runRemoval() {
    if (!baseImage) return
    setBusy(true)
    setError(null)
    setProgress({ phase: 'Preparing' })
    try {
      if (method === 'brush') {
        const mask = brushRef.current?.getMask()
        if (!mask) throw new Error('No mask painted')
        const imgCanvas = imageToCanvas(baseImage)
        const onProgress: ProgressCb = (p) => setProgress(p)
        const out = await inpaint({
          image: imgCanvas,
          mask,
          modelUrl,
          onProgress,
        })
        setResult(out)
      } else {
        if (!watermark) throw new Error('Watermark image not loaded')
        const out = inverseBlend({
          watermarked: baseImage,
          watermark,
          options: wmOptions,
        })
        setResult(out)
      }
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function handleDownload() {
    if (!result) return
    const blob = await canvasToBlob(result, 'image/jpeg', 0.95)
    downloadBlob(blob, `${baseName}-clean.jpg`)
  }

  // Style the result canvas as soon as we set it so the mount effect is a
  // simple appendChild.
  useEffect(() => {
    if (result) styleResultCanvas(result)
  }, [result])

  const resultHostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = resultHostRef.current
    if (!host) return
    host.innerHTML = ''
    if (result) host.appendChild(result)
  }, [result])

  const knownPreview = useMemo(() => {
    if (method !== 'known' || !baseImage || !watermark) return null
    // Render the watermark layer over the image at the current spec so the user
    // can see WHERE the inverse-blend will try to recover.
    const c = imageToCanvas(baseImage)
    const ctx = c.getContext('2d')!
    const baseW = c.width
    const baseH = c.height
    const wmW = watermark.naturalWidth
    const wmH = watermark.naturalHeight
    const shorter = Math.min(baseW, baseH)
    const tw = Math.round(shorter * wmOptions.scale)
    const th = Math.round((tw / wmW) * wmH)
    const margin = Math.round(shorter * wmOptions.margin)
    const { x, y } = positionFromAnchor(wmOptions.anchor, baseW, baseH, tw, th, margin)
    ctx.save()
    ctx.strokeStyle = 'rgba(79,140,255,0.9)'
    ctx.lineWidth = Math.max(2, shorter / 400)
    ctx.setLineDash([10, 6])
    ctx.strokeRect(x, y, tw, th)
    ctx.restore()
    styleResultCanvas(c)
    return c
  }, [method, baseImage, watermark, wmOptions])

  const previewHostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = previewHostRef.current
    if (!host) return
    host.innerHTML = ''
    if (knownPreview) host.appendChild(knownPreview)
  }, [knownPreview])

  return (
    <div className="layout">
      <aside className="panel">
        <section className="block">
          <h2>1. Watermarked image</h2>
          <label className="upload-btn">
            <input type="file" accept="image/*" onChange={handleUpload} />
            {baseImage ? 'Replace image' : 'Choose image'}
          </label>
          {baseImage && (
            <p className="muted small">
              {baseImage.naturalWidth} × {baseImage.naturalHeight}
            </p>
          )}
        </section>

        <section className="block">
          <h2>2. Method</h2>
          <div className="method-tabs">
            <button
              className={method === 'brush' ? 'primary' : ''}
              onClick={() => setMethod('brush')}
            >
              Paint mask (AI)
            </button>
            <button
              className={method === 'known' ? 'primary' : ''}
              onClick={() => setMethod('known')}
            >
              Known watermark (math)
            </button>
          </div>
          <p className="muted small">
            {method === 'brush'
              ? 'Paint over the watermark, then AI inpaints. Works on any watermark. Downloads a ~200MB model on first use.'
              : 'Mathematically reverses standard alpha-blend. Instant and near-perfect when you have the exact watermark PNG and blend params.'}
          </p>
        </section>

        {method === 'brush' && (
          <section className="block">
            <h2>3. Brush</h2>
            <div className="tool-row">
              <button
                className={tool === 'brush' ? 'primary' : ''}
                onClick={() => setTool('brush')}
              >
                Brush
              </button>
              <button
                className={tool === 'eraser' ? 'primary' : ''}
                onClick={() => setTool('eraser')}
              >
                Eraser
              </button>
              <button onClick={() => brushRef.current?.clear()}>Clear</button>
            </div>
            <label className="field">Size: {brushSize}px</label>
            <input
              type="range"
              min={4}
              max={300}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />

            <details>
              <summary className="muted small">Advanced: model URL</summary>
              <input
                type="text"
                value={modelUrl}
                onChange={(e) => setModelUrl(e.target.value)}
                spellCheck={false}
              />
              <p className="muted small">
                ONNX inpainting model. Default: LaMa from Carve on Hugging Face.
              </p>
            </details>
          </section>
        )}

        {method === 'known' && (
          <section className="block">
            <h2>3. Watermark spec</h2>
            <label className="upload-btn">
              <input type="file" accept="image/*" onChange={handleWatermarkUpload} />
              {usingDefaultWm ? 'Choose watermark PNG' : 'Replace watermark'}
            </label>
            {usingDefaultWm && (
              <p className="muted small">
                Using default watermark. Use the same PNG that was originally applied.
              </p>
            )}

            <label className="field">Anchor</label>
            <div className="anchor-grid">
              {ANCHORS.map((a) => (
                <button
                  key={a}
                  className={`anchor-cell ${wmOptions.anchor === a ? 'active' : ''}`}
                  onClick={() => setWmOptions({ ...wmOptions, anchor: a })}
                  title={a}
                />
              ))}
            </div>

            <label className="field">Opacity: {(wmOptions.opacity * 100).toFixed(0)}%</label>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.01}
              value={wmOptions.opacity}
              onChange={(e) =>
                setWmOptions({ ...wmOptions, opacity: Number(e.target.value) })
              }
            />

            <label className="field">Size: {(wmOptions.scale * 100).toFixed(0)}%</label>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={wmOptions.scale}
              onChange={(e) =>
                setWmOptions({ ...wmOptions, scale: Number(e.target.value) })
              }
            />

            <label className="field">Margin: {(wmOptions.margin * 100).toFixed(1)}%</label>
            <input
              type="range"
              min={0}
              max={0.2}
              step={0.005}
              value={wmOptions.margin}
              onChange={(e) =>
                setWmOptions({ ...wmOptions, margin: Number(e.target.value) })
              }
            />
          </section>
        )}

        <section className="block">
          <button
            className="primary"
            disabled={!baseImage || busy}
            onClick={runRemoval}
          >
            {busy ? 'Working...' : 'Remove watermark'}
          </button>
          {progress && (
            <p className="muted small">
              {progress.phase}
              {progress.progress != null
                ? ` — ${(progress.progress * 100).toFixed(0)}%`
                : ''}
            </p>
          )}
          {error && <p className="error small">{error}</p>}
          {result && (
            <button className="primary" onClick={handleDownload} style={{ marginTop: 8 }}>
              Download cleaned image
            </button>
          )}
        </section>
      </aside>

      <main className="preview">
        {!baseImage && (
          <div className="empty-state">
            <p>Upload a watermarked image to begin.</p>
          </div>
        )}

        {baseImage && method === 'brush' && !result && (
          <BrushCanvas
            image={baseImage}
            brushSize={brushSize}
            tool={tool}
            onReady={(h) => (brushRef.current = h)}
          />
        )}

        {baseImage && method === 'known' && !result && (
          <div ref={previewHostRef} className="preview-host" />
        )}

        {result && <div ref={resultHostRef} className="preview-host" />}
      </main>
    </div>
  )
}

function positionFromAnchor(
  anchor: Anchor,
  baseW: number,
  baseH: number,
  w: number,
  h: number,
  margin: number,
) {
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
