import { useState } from 'react'
import { ApplyMode } from './components/ApplyMode'
import { RemoveMode } from './components/RemoveMode'
import './App.css'

type Mode = 'apply' | 'remove'

function App() {
  const [mode, setMode] = useState<Mode>('remove')

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-mark" />
          <h1>Watermarker</h1>
          <span className="muted small">apply &amp; remove watermarks</span>
        </div>
        <nav className="mode-switch">
          <button
            className={mode === 'apply' ? 'primary' : ''}
            onClick={() => setMode('apply')}
          >
            Apply
          </button>
          <button
            className={mode === 'remove' ? 'primary' : ''}
            onClick={() => setMode('remove')}
          >
            Remove
          </button>
        </nav>
      </header>

      {mode === 'apply' ? <ApplyMode /> : <RemoveMode />}
    </div>
  )
}

export default App
