import os
import re

with open('src/components/player/ExpandedPlayerUI.tsx', 'r') as f:
    text = f.read()

# Add state
target_state = r'  const \[spatialExtra, setSpatialExtra\] = useState\(0\.0\);'
replace_state = '''  const [spatialExtra, setSpatialExtra] = useState(0.0);
  const [depthAmount, setDepthAmount] = useState(0.0);'''
text = re.sub(target_state, replace_state, text)

# Add command to presets
target_preset = r'let pRem=false,pCmp=false,pDrv=0\.0,pWid=1\.0,p3D=0\.0,pRvb=0\.0,pBas=0\.0,pTrb=0\.0;'
replace_preset = '''let pRem=false,pCmp=false,pDrv=0.0,pWid=1.0,p3D=0.0,pDep=0.0,pRvb=0.0,pBas=0.0,pTrb=0.0;'''
text = re.sub(target_preset, replace_preset, text)

target_preset_val1 = r'else if\(preset===\'CINEMATIC\'\)\{pRem=true;pCmp=true;pDrv=1\.2;pWid=1\.35;p3D=0\.25;pRvb=0\.16;pBas=0\.8;pTrb=0\.5;\}'
replace_preset_val1 = '''else if(preset==='CINEMATIC'){pRem=true;pCmp=true;pDrv=1.2;pWid=1.35;p3D=0.25;pDep=0.4;pRvb=0.16;pBas=0.8;pTrb=0.5;}'''
text = re.sub(target_preset_val1, replace_preset_val1, text)

target_preset_val2 = r'else\{p3D=0\.40;pRvb=0\.22;pBas=0\.1;pTrb=0\.1;\}'
replace_preset_val2 = '''else{p3D=0.40;pDep=0.6;pRvb=0.22;pBas=0.1;pTrb=0.1;}'''
text = re.sub(target_preset_val2, replace_preset_val2, text)

target_preset_set = r'setSpatialExtra\(p3D\);setReverbWet\(pRvb\);'
replace_preset_set = '''setSpatialExtra(p3D);setDepthAmount(pDep);setReverbWet(pRvb);'''
text = re.sub(target_preset_set, replace_preset_set, text)

target_preset_cmd = r'await writeToEngine\(3D \$\{p3D\}\);await writeToEngine\(REVERB \$\{pRvb\}\);'
replace_preset_cmd = '''await writeToEngine(3D );await writeToEngine(DEPTH );await writeToEngine(REVERB );'''
text = re.sub(target_preset_cmd, replace_preset_cmd, text)

# Add Slider
target_slider = r'          <div className="dsp-card" style=\{disabledStyle\}>\s*<div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">\{spatialExtra>0\?\+\$\{Math\.round\(spatialExtra\*100\)\}%:\'Base\'\}</span></div>\s*<input type="range" className="dsp-slider spatial" min="0" max="1" step="0\.05" value=\{spatialExtra\} onChange=\{e=>\{const v=parseFloat\(e\.target\.value\);setSpatialExtra\(v\);writeToEngine\(3D \$\{v\}\);\}\}/>\s*</div>'
replace_slider = '''          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>3D Depth</label><span className="val-purple">{spatialExtra>0?+%:'Base'}</span></div>
            <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={spatialExtra} onChange={e=>{const v=parseFloat(e.target.value);setSpatialExtra(v);writeToEngine(3D );}}/>
          </div>
          <div className="dsp-card" style={disabledStyle}>
            <div className="dsp-label-row"><label>Vocal Frontness (Blauert)</label><span className="val-purple">{depthAmount>0?+%:'Off'}</span></div>
            <input type="range" className="dsp-slider spatial" min="0" max="1" step="0.05" value={depthAmount} onChange={e=>{const v=parseFloat(e.target.value);setDepthAmount(v);writeToEngine(DEPTH );}}/>
          </div>'''
text = re.sub(target_slider, replace_slider, text)

with open('src/components/player/ExpandedPlayerUI.tsx', 'w') as f:
    f.write(text)
print("Updated ExpandedPlayerUI.tsx")
