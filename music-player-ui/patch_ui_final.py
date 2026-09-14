import os
import re

with open('src/components/player/ExpandedPlayerUI.tsx', 'r') as f:
    text = f.read()

# Add the UI slider below 3D Depth
target_slider = r'(<div className="dsp-card" style=\{disabledStyle\}>\s*<div className="dsp-label-row"><label>3D Depth</label>.*?</div>)'
replace_slider = r'''\1
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Vocal Frontness (Blauert)</label><span className="val-purple">{depthAmount>0?+%:'Off'}</span></div>
            <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={depthAmount} onChange={e=>{const v=parseFloat(e.target.value);setDepthAmount(v);writeToEngine(DEPTH );}}/>
          </div>'''

text = re.sub(target_slider, replace_slider, text)

if 'const [depthAmount, setDepthAmount] = useState(0.0);' not in text:
    text = text.replace('const [spatialExtra, setSpatialExtra] = useState(0.0);', 'const [spatialExtra, setSpatialExtra] = useState(0.0);\n  const [depthAmount, setDepthAmount] = useState(0.0);')

with open('src/components/player/ExpandedPlayerUI.tsx', 'w') as f:
    f.write(text)
print("Updated ExpandedPlayerUI.tsx")
