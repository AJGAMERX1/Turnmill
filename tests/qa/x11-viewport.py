"""Locate a headed Chromium viewport on X11 using a calibration page, then crop real display pixels."""
import io
import json
import os
import sys
import time

from PIL import ImageGrab

command = sys.argv[1]
width, height = map(int, sys.argv[2:4])
display = os.environ["DISPLAY"]


def grab():
    return ImageGrab.grab(xdisplay=display).convert("RGB")


def viewport(image, x, y):
    if x < 0 or y < 0 or x + width > image.width or y + height > image.height:
        raise ValueError(f"Viewport {width}×{height} at {x},{y} falls outside X display {image.size}")
    return image.crop((x, y, x + width, y + height))


if command == "locate":
    # The initial blank page contains these four 12px corner swatches. Search
    # the complete real display. Confirm all four, including the far edges.
    colors = [(247, 41, 119), (17, 229, 89), (43, 91, 241), (233, 193, 23)]
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        screen = grab()
        raw = screen.tobytes()
        at = raw.find(bytes(colors[0]) * 12)
        if at >= 0 and at % 3 == 0:
            y, x = divmod(at // 3, screen.width)
            if x + width <= screen.width and y + height <= screen.height:
                # Comparing the last row/column rules out an off-by-one crop.
                points = [(x, y), (x + width - 1, y), (x, y + height - 1),
                          (x + width - 1, y + height - 1)]
                outside = [(x - 1, y), (x, y - 1), (x + width, y), (x, y + height)]
                if [screen.getpixel(p) for p in points] == colors and all(
                    screen.getpixel(p) not in colors for p in outside
                    if 0 <= p[0] < screen.width and 0 <= p[1] < screen.height
                ):
                    print(json.dumps({"x": x, "y": y}))
                    break
        time.sleep(0.12)
    else:
        raise RuntimeError(f"Chromium calibration corners {width}×{height} were not visible on X display {screen.size}")
elif command == "capture":
    x, y = map(int, sys.argv[4:6])
    pixels = viewport(grab(), x, y)
    data = io.BytesIO()
    pixels.save(data, format="PNG")
    sys.stdout.buffer.write(data.getvalue())
else:
    raise ValueError(f"Unknown X11 capture operation {command}")
