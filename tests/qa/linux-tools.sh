#!/usr/bin/env bash
set -euo pipefail
tools_dir="${RUNNER_TEMP:-/tmp}/turnmill-cad-tools"
mkdir -p "$tools_dir"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends cmake ninja-build build-essential libgl1 libegl1 libglu1-mesa libxkbcommon-x11-0 libxcb-cursor0 libxcb-xinerama0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 libxcb-render-util0 xvfb xauth prusa-slicer poppler-utils
python3 -m venv "$tools_dir/venv"
"$tools_dir/venv/bin/pip" install 'ezdxf==1.4.5' 'pypdf>=6,<7' 'Pillow>=11,<13' 'pdfplumber>=0.11,<0.12'
cad_file=FreeCAD_1.1.4-Linux-x86_64-py311.AppImage
curl --fail --location --retry 3 "https://github.com/FreeCAD/FreeCAD/releases/download/1.1.4/$cad_file" -o "$tools_dir/$cad_file"
(cd "$tools_dir" && echo "f6dc6ba676e5ac96a565ebc8d657232f94c6158e85b4352141bd1a46f6b43434  $cad_file" | sha256sum -c - && chmod +x "$cad_file" && "./$cad_file" --appimage-extract >/dev/null)
cat > "$tools_dir/freecadcmd" <<'WRAPPER'
#!/usr/bin/env bash
exec "$(dirname "$0")/squashfs-root/AppRun" "$@"
WRAPPER
chmod +x "$tools_dir/freecadcmd"
git clone --depth 1 --branch v0.8.2 https://github.com/stepcode/stepcode "$tools_dir/stepcode"
test "$(git -C "$tools_dir/stepcode" rev-parse HEAD)" = 5cf8fc1a8907983365b233280f128566956713fa
cmake -S "$tools_dir/stepcode" -B "$tools_dir/step-build" -G Ninja -DSC_BUILD_SCHEMAS='ap214e3;ap242' -DSC_UNITY_BUILD=ON -DCMAKE_BUILD_TYPE=Release
cmake --build "$tools_dir/step-build" --parallel 2 --target p21read_sdai_ap214e3 p21read_sdai_ap242
{
  echo "FREECAD_CMD=$tools_dir/freecadcmd"
  echo "PRUSASLICER=$(command -v prusa-slicer)"
  echo "STEPCODE_AP242=$tools_dir/step-build/bin/p21read_sdai_ap242"
  echo "STEPCODE_AP214=$tools_dir/step-build/bin/p21read_sdai_ap214e3"
  echo "QA_PYTHON=$tools_dir/venv/bin/python"
} >> "$GITHUB_ENV"
