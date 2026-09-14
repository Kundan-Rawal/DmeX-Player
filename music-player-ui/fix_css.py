import os

files = [
    'src/components/player/MobileExpandedPlayer.css',
    'src/App.css',
    'src/views/AlbumGalleryView.css'
]

for file in files:
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            text = f.read()
        
        # Replace border shorthand with color-mix
        text = text.replace('border: 1px solid color-mix(', 'border-width: 1px !important; border-style: solid !important; border-color: color-mix(')
        
        with open(file, 'w', encoding='utf-8') as f:
            f.write(text)
print("Replaced border color-mix shorthand")
