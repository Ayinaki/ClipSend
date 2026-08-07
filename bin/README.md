# Bundled Binaries

`ffmpeg.exe`, `ffprobe.exe`, and `gifski.exe` live in this directory and are
shipped inside the installer, so the app works out of the box (no manual
downloads for users). The exes are gitignored — download or build them, drop
them here, and CI/local builds pick them up automatically.

- **`ffmpeg.exe` & `ffprobe.exe`**
- **`gifski.exe`**: High-quality GIF encoder binary from [ImageOptim/gifski releases](https://github.com/ImageOptim/gifski/releases).

## ⚠️ The 480 MB footprint problem

The stock gyan.dev "essentials" builds (`ffmpeg.exe` + `ffprobe.exe`) are
**~98 MB each** — together **~196 MB**, roughly 40% of the ~480 MB installed
app. They ship ~100 libraries ClipSend never touches (cairo, gnutls, libsrt,
libssh, zmq, avisynth, SDL2, openjpeg, x265, vmaf, rubberband, ...).

ClipSend actually uses a small, well-defined feature set: a handful of
encoders (`libx264`, `libaom-av1`, `libsvtav1`, `aac`, `libmp3lame`, `mjpeg`,
hardware `nvenc`/`qsv`/`amf`), common container demuxers/muxers, and a few
filters (`trim`, `scale`, `crop`, `concat`, `setpts`...).

### Recommended: build minimal binaries (roughly 30–50 MB total, saves ~150–165 MB)

`scripts/build-ffmpeg.sh` cross-compiles a lean static `ffmpeg.exe` +
`ffprobe.exe` for Windows x64 on Linux (mingw-w64, the same approach
gyan.dev/BtbN use), configured with `--disable-everything` plus only the
features above.

```bash
# locally on Linux (needs mingw-w64, cmake, ninja, nasm):
bash scripts/build-ffmpeg.sh
# → artifacts/ffmpeg.exe, artifacts/ffprobe.exe
```

Or run the **"Build Minimal FFmpeg (Windows x64)"** GitHub Actions workflow
(`workflow_dispatch`) and download the `ffmpeg-minimal-win64` artifact.
Hardware encoders can be toggled off from the workflow inputs if a dependency
misbehaves (`BUILD_VPL=0`, `BUILD_NVENC=0`, `BUILD_AMF=0` env flags do the
same locally). **Intel QSV (oneVPL) is the most likely build friction point**
when cross-compiling — if the build dies there, rerun with QSV off and export
those clips with a CPU/hardware encoder you have.

Then copy `ffmpeg.exe` / `ffprobe.exe` over the ones in `bin/` and rebuild.

Notes:
- The feature list was audited against `main/*.js` (encoders, demuxers,
  muxers, filters, protocols). The `concat` demuxer is included for the
  lossless merge fast path, and the AMF include layout was verified against
  ffmpeg's `configure` check (`AMF/core/Version.h`).
- SVT-AV1 is pinned to the `v4.2.0` release tag (not master) and built static
  (`BUILD_SHARED_LIBS=OFF`) so `ffmpeg.exe` needs no sidecar DLL. If a future
  SVT-AV1 release breaks the build, bump the tag in `scripts/build-ffmpeg.sh`.
- The decoder/demuxer lists are deliberately a bit wider than the app's
  own `ALLOWED_EXTENSIONS` (`mp4/mkv/mov/avi/webm`) so odd input files still
  load — trim `flv/mpegts/ogg` etc. if you want the last few MB back.

### Quick check after swapping

```powershell
.\bin\ffmpeg.exe -version        # confirm it runs
.\bin\ffmpeg.exe -encoders | findstr /i "nvenc qsv amf libx264 libaom libsvtav1"
.\bin\ffprobe.exe -version       # ffprobe must run too
```

Export a small test clip with each encoder you care about (CPU H.264, CPU
AV1, NVENC/QSV/AMF if you have the hardware) to confirm nothing regressed.
