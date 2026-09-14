import sys

with open('src/components/player/MobileExpandedPlayer.css', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for i, line in enumerate(lines):
    if i >= 1486 and i <= 1494:
        # these are the floating lines
        pass
    else:
        new_lines.append(line)

with open('src/components/player/MobileExpandedPlayer.css', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print("Removed floating css")
