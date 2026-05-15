import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyWatermark,
  type Anchor,
  type WatermarkOptions,
} from '../lib/compositor'
import {
  canvasToBlob,
  downloadBlob,
  fileToImage,
  styleResultCanvas,
} from '../lib/canvas'
import { getDefaultWatermarkImage } from '../lib/defaultWatermark'

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

export function ApplyMode() {
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null)
  const [baseName, setBaseName] = useState<string>('image')
  const [watermark, setWatermark] = useState<HTMLImageElement | null>(null)
  const [usingDefaultWm, setUsingDefaultWm] = useState(true)
  const [options, setOptions] = useState<WatermarkOptions>({
    opacity: 0.4,
    scale: 0.35,
    margin: 0.025,
    anchor: 'bottom-right',
    rotation: 0,
    tile: false,
  })

  // Load default watermark once.
  useEffect(() => {
    if (watermark) return
    getDefaultWatermarkImage().then(setWatermark)
  }, [watermark])

  const preview = useMemo(() => {
    if (!baseImage || !watermark) return null
    const out = applyWatermark(baseImage, watermark, options)
    styleResultCanvas(out.canvas)
    return out
  }, [baseImage, watermark, options])

  const previewHostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = previewHostRef.current
    if (!host) return
    host.innerHTML = ''
    if (preview) host.appendChild(preview.canvas)
  }, [preview])

  async function handleBaseUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBaseName(file.name.replace(/\.[^.]+$/, ''))
    const img = await fileToImage(file)
    setBaseImage(img)
  }

  async function handleWatermarkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const img = await fileToImage(file)
    setWatermark(img)
    setUsingDefaultWm(false)
  }

  async function handleDownload() {
    if (!preview) return
    const blob = await canvasToBlob(preview.canvas, 'image/jpeg', 0.95)
    downloadBlob(blob, `${baseName}-watermarked.jpg`)
  }

  return (
    <div className="layout">
      <aside className="panel">
        <section className="block">
          <h2>1. Source image</h2>
          <label className="upload-btn">
            <input type="file" accept="image/*" onChange={handleBaseUpload} />
            {baseImage ? 'Replace image' : 'Choose image'}
          </label>
          {baseImage && (
            <p className="muted small">
              {baseImage.naturalWidth} × {baseImage.naturalHeight}
            </p>
          )}
        </section>

        <section className="block">
          <h2>2. Watermark</h2>
          <label className="upload-btn">
            <input type="file" accept="image/*" onChange={handleWatermarkUpload} />
            {usingDefaultWm ? 'Choose watermark PNG' : 'Replace watermark'}
          </label>
          {usingDefaultWm && (
            <p className="muted small">
              Using built-in default. Replace with your transparent PNG for production.
            </p>
          )}
        </section>

        <section className="block">
          <h2>3. Placement</h2>

          <label className="field">Anchor</label>
          <div className="anchor-grid">
            {ANCHORS.map((a) => (
              <button
                key={a}
                className={`anchor-cell ${options.anchor === a ? 'active' : ''}`}
                onClick={() => setOptions({ ...options, anchor: a })}
                title={a}
              />
            ))}
          </div>

          <label className="field">Opacity: {(options.opacity * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={options.opacity}
            onChange={(e) =>
              setOptions({ ...options, opacity: Number(e.target.value) })
            }
          />

          <label className="field">Size: {(options.scale * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={options.scale}
            onChange={(e) =>
              setOptions({ ...options, scale: Number(e.target.value) })
            }
          />

          <label className="field">Margin: {(options.margin * 100).toFixed(1)}%</label>
          <input
            type="range"
            min={0}
            max={0.2}
            step={0.005}
            value={options.margin}
            onChange={(e) =>
              setOptions({ ...options, margin: Number(e.target.value) })
            }
          />

          <label className="field">Rotation: {options.rotation ?? 0}°</label>
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={options.rotation ?? 0}
            onChange={(e) =>
              setOptions({ ...options, rotation: Number(e.target.value) })
            }
          />

          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!options.tile}
              onChange={(e) =>
                setOptions({ ...options, tile: e.target.checked })
              }
            />
            Tile across image
          </label>
        </section>

        <section className="block">
          <button
            className="primary"
            disabled={!preview}
            onClick={handleDownload}
          >
            Download watermarked image
          </button>
        </section>
      </aside>

      <main className="preview">
        {!baseImage && (
          <div className="empty-state">
            <p>Upload an image to begin.</p>
          </div>
        )}
        <div ref={previewHostRef} className="preview-host" />
      </main>
    </div>
  )
}
