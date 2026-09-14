import sys
with open('src-tauri/Cargo.toml', 'r') as f:
    text = f.read()

text = text.replace('[dependencies]', '[dependencies]\nrubato = "0.15"\n')

with open('src-tauri/Cargo.toml', 'w') as f:
    f.write(text)
print("Added rubato to Cargo.toml")
