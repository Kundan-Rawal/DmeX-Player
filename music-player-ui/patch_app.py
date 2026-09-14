import os
import re

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# Add state
text = re.sub(r'(const \[spatialExtra, setSpatialExtra\]\s*= useState\(0\.0\);)', r'\1\n  const [depthAmount, setDepthAmount]       = useState(0.0);', text)

# Pass down to ExpandedPlayerUI and MobileExpandedPlayer
text = text.replace('spatialExtra={spatialExtra} setSpatialExtra={setSpatialExtra}', 'spatialExtra={spatialExtra} setSpatialExtra={setSpatialExtra} depthAmount={depthAmount} setDepthAmount={setDepthAmount}')

# Save/load settings
text = text.replace('spatialExtra, reverbWet, restorationDenoise', 'spatialExtra, depthAmount, reverbWet, restorationDenoise')
text = text.replace('if (settings.spatialExtra !== undefined) setSpatialExtra(settings.spatialExtra);', 'if (settings.spatialExtra !== undefined) setSpatialExtra(settings.spatialExtra);\n          if (settings.depthAmount !== undefined) setDepthAmount(settings.depthAmount);')
text = text.replace('await writeToEngine(3D );', 'await writeToEngine(3D );\n                         await writeToEngine(DEPTH );')

# Smart settings
text = text.replace('setSpatialExtra(s.spatial);', 'setSpatialExtra(s.spatial);\n      setDepthAmount(0.0);')
text = text.replace('setSpatialExtra(0);setReverbWet(0);', 'setSpatialExtra(0);setDepthAmount(0);setReverbWet(0);')
text = text.replace('await writeToEngine(3D 0);await writeToEngine(REVERB 0);', 'await writeToEngine(3D 0);await writeToEngine(DEPTH 0);await writeToEngine(REVERB 0);')

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(text)
print("Updated App.tsx")
