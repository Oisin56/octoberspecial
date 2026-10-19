# A full-height phone screen: the app's screen with a strip on top, in its own colour, for the status bar.
# Usage: compose.py in.png out.jpg  -> prints "dark" or "light"
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
W, H = im.size  # 1170 x 2391 (390 x 797 at 3x)
strip = round(W * 47 / 390)
canvas = Image.new("RGB", (W, H + strip))
# the strip takes the colour of the screen's first rows (most common colour)
top = im.crop((0, 12, W, 18)).getcolors(W * 6)
colour = max(top, key=lambda c: c[0])[1]
canvas.paste(Image.new("RGB", (W, strip), colour), (0, 0))
canvas.paste(im, (0, strip))
canvas.save(out, quality=82, optimize=True, progressive=True)
lum = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]
print("dark" if lum < 140 else "light")
