import os
import re

with open('src/components/player/ExpandedPlayerUI.tsx', 'r') as f:
    text = f.read()

target = r'(<div className="dsp-card" style=\{disabledStyle\}>\s*<div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">\{spatialExtra>0\?\+\$\{Math\.round\(spatialExtra\*100\)\}%:\'Base\'\}</span></div>\s*<input type="range" className="dsp-slider spatial" min="0" max="1" step="0\.05" value=\{spatialExtra\} onChange=\{e=>\{const v=parseFloat\(e\.target\.value\);setSpatialExtra\(v\);writeToEngine\(3D \$\{v\}\);\}\}/>\s*</div>)'
replace = r'''\1
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Vocal Frontness (Blauert)</label><span className="val-purple">{depthAmount>0?+%:'Off'}</span></div>
            <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={depthAmount} onChange={e=>{const v=parseFloat(e.target.value);setDepthAmount(v);writeToEngine(DEPTH );}}/>
          </div>'''
text = re.sub(target, replace, text)

# Add state
if 'const [depthAmount, setDepthAmount] = useState(0.0);' not in text:
    target_state = r'  const \[spatialExtra, setSpatialExtra\] = useState\(0\.0\);'
    replace_state = '''  const [spatialExtra, setSpatialExtra] = useState(0.0);
  const [depthAmount, setDepthAmount] = useState(0.0);'''
    text = re.sub(target_state, replace_state, text)

with open('src/components/player/ExpandedPlayerUI.tsx', 'w') as f:
    f.write(text)
print("Added Vocal Frontness slider to ExpandedPlayerUI.tsx")
