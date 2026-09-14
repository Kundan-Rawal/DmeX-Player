import os
import re

with open('src/components/player/ExpandedPlayerUI.tsx', 'r') as f:
    text = f.read()

target = r'await writeToEngine\(3D \$\{p3D\}\);await writeToEngine\(REVERB \$\{pRvb\}\);'
replace = '''await writeToEngine(3D );await writeToEngine(DEPTH );await writeToEngine(REVERB );'''
text = re.sub(target, replace, text)

with open('src/components/player/ExpandedPlayerUI.tsx', 'w') as f:
    f.write(text)
print("Fixed preset commands")
