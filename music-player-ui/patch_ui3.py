import os

with open('src/components/player/ExpandedPlayerUI.tsx', 'r') as f:
    text = f.read()

target = '''        <div className="dsp-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="dsp-card">
            <div className="dsp-label-row"><label>Tube Exciter (Air)</label><span className="val-green">{Math.round(trebleLevel*100)}%</span></div>
            <input type="range" className="dsp-slider exciter" min="0" max="1" step="0.05" value={trebleLevel} onChange={e=>{const v=parseFloat(e.target.value);setTrebleLevel(v);writeToEngine(TREBLE );}}/>
          </div>
          <div className="dsp-card">
            <div className="dsp-label-row"><label>Stereo Width</label><span className="val-blue">{widenWidth>1.0?${Math.round((widenWidth-1.0)*100)}% extra:'Original'}</span></div>
            <input type="range" className="dsp-slider widen" min="1.0" max="1.5" step="0.05" value={widenWidth} onChange={e=>{const v=parseFloat(e.target.value);setWidenWidth(v);writeToEngine(WIDEN );}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">{spatialExtra>0?+%:'Base'}</span></div>
            <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={spatialExtra} onChange={e=>{const v=parseFloat(e.target.value);setSpatialExtra(v);writeToEngine(3D );}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Digital Reverb (Algorithmic)</label><span className="val-orange">{Math.round(reverbWet*100)}%</span></div>
            <input type="range" className="dsp-slider reverb" min="0" max="0.35" step="0.01" value={reverbWet} onChange={e=>{const v=parseFloat(e.target.value);setReverbWet(v);writeToEngine(REVERB );}}/>
          </div>
        </div>'''

replace = '''        <div className="dsp-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="dsp-card">
            <div className="dsp-label-row"><label>Tube Exciter (Air)</label><span className="val-green">{Math.round(trebleLevel*100)}%</span></div>
            <input type="range" className="dsp-slider exciter" min="0" max="1" step="0.05" value={trebleLevel} onChange={e=>{const v=parseFloat(e.target.value);setTrebleLevel(v);writeToEngine(TREBLE );}}/>
          </div>
          <div className="dsp-card">
            <div className="dsp-label-row"><label>Stereo Width</label><span className="val-blue">{widenWidth>1.0?${Math.round((widenWidth-1.0)*100)}% extra:'Original'}</span></div>
            <input type="range" className="dsp-slider widen" min="1.0" max="1.5" step="0.05" value={widenWidth} onChange={e=>{const v=parseFloat(e.target.value);setWidenWidth(v);writeToEngine(WIDEN );}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">{spatialExtra>0?+%:'Base'}</span></div>
            <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={spatialExtra} onChange={e=>{const v=parseFloat(e.target.value);setSpatialExtra(v);writeToEngine(3D );}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Vocal Frontness (Blauert)</label><span className="val-purple">{depthAmount>0?+%:'Off'}</span></div>
            <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={depthAmount} onChange={e=>{const v=parseFloat(e.target.value);setDepthAmount(v);writeToEngine(DEPTH );}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Digital Reverb (Algorithmic)</label><span className="val-orange">{Math.round(reverbWet*100)}%</span></div>
            <input type="range" className="dsp-slider reverb" min="0" max="0.35" step="0.01" value={reverbWet} onChange={e=>{const v=parseFloat(e.target.value);setReverbWet(v);writeToEngine(REVERB );}}/>
          </div>
        </div>'''

text = text.replace(target, replace)

if 'const [depthAmount, setDepthAmount] = useState(0.0);' not in text:
    text = text.replace('const [spatialExtra, setSpatialExtra] = useState(0.0);', 'const [spatialExtra, setSpatialExtra] = useState(0.0);\n  const [depthAmount, setDepthAmount] = useState(0.0);')

with open('src/components/player/ExpandedPlayerUI.tsx', 'w') as f:
    f.write(text)
print("Updated ExpandedPlayerUI.tsx manually")
