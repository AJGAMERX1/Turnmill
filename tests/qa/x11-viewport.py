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
elif command in ("present", "capture"):
    x, y = map(int, sys.argv[4:6])
    color = tuple(json.loads(sys.argv[6]))
    # Every probe is two physical pixels wide and tall at DPR 1.
    corners = [(x + dx, y + dy) for dx in (0, 1, width - 2, width - 1)
               for dy in (0, 1, height - 2, height - 1)]
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        screen = grab()
        marked = [screen.getpixel(point) == color for point in corners]
        if command == "present" and all(marked):
            break
        if command == "capture" and not any(marked):
            data = io.BytesIO()
            viewport(screen, x, y).save(data, format="PNG")
            sys.stdout.buffer.write(data.getvalue())
            break
        time.sleep(0.04)
    else:
        raise RuntimeError(f"X11 did not display the {command} frame at all four viewport corners")
else:
    raise ValueError(f"Unknown X11 capture operation {command}")
