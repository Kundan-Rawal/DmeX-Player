
import os

with open("src/App.tsx", "r", encoding="utf-8") as f:
    text = f.read()

text = text.replace("await writeToEngine(DEPTH );", "await writeToEngine(`DEPTH ${s.depth}`);")

with open("src/App.tsx", "w", encoding="utf-8") as f:
    f.write(text)
print("Fixed App.tsx")

