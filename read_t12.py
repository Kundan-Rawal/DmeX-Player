import sys
with open('C:/Users/LEGION/.gemini/antigravity/brain/25b7cbb9-4ec4-4083-a15d-190227ec34fe/.user_uploaded/media_1789377586446.txt', 'r', encoding='utf-8') as f:
    text = f.read()

idx = text.find('T12.2 Option A')
if idx != -1:
    print(text[idx:idx+2500])
