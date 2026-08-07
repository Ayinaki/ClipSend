#!/usr/bin/env bash
#
# Build a MINIMAL ffmpeg.exe + ffprobe.exe for Windows x64, cross-compiled on
# Linux with the mingw-w64 toolchain — the same approach gyan.dev and
# BtbN/FFmpeg-Builds use.
#
# WHY: the stock gyan.dev "essentials" builds ship ~100 libraries ClipSend
# never touches (cairo, gnutls, srt, ssh, zmq, avisynth, SDL, openjpeg, vmaf,
# rubberband, ...) which is why each binary is ~98 MB. ClipSend actually uses
# a handful of encoders, demuxers and filters; a --disable-everything build
# with just those lands at roughly 10-20 MB per binary — cutting the bundled
# footprint from ~196 MB to ~30 MB and the installed app from ~480 MB to
# ~320 MB — while still shipping the binaries in the installer (no manual
# downloads for users).
#
# REQUIRED feature set (audited against main/*.js):
#   encoders : libx264, libaom-av1, libsvtav1, aac, libmp3lame, mjpeg (thumbs),
#              rawvideo (gifski y4m), pcm_s16le (waveform),
#              h264/av1 nvenc + qsv + amf (hardware)
#   muxers   : mp4/mov (+faststart), matroska/webm, mp3, gif, image2, wav,
#              pcm_s16le, yuv4mpegpipe, avi, flv, mpegts, ogg
#   demuxers : mov, matroska, avi, flv, mpegts, mpegps, mp3, wav, ogg, image2,
#              gif, m4v
#   decoders : h264/hevc/av1/vp8/vp9/mpeg4/mpeg2video/mjpeg/wmv3/msmpeg4,
#              aac/mp3/ac3/eac3/opus/vorbis/flac/alac/truehd/pcm_*
#   filters  : trim, setpts, scale, crop, fps, format, split, concat,
#              overlay, pad, null, anull
#   protocols: file, pipe, concat
#
# Usage (in CI or locally on Linux):
#   bash scripts/build-ffmpeg.sh
# Outputs:
#   artifacts/ffmpeg.exe
#   artifacts/ffprobe.exe
#
# Each external dependency can be skipped with an env flag so a troublesome
# one doesn't sink the whole build (e.g. BUILD_VPL=0 drops QSV support):
#   BUILD_X264 BUILD_AOM BUILD_SVT BUILD_LAME BUILD_VPL BUILD_NVENC BUILD_AMF
# Default: all on.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.ffbuild"
PREFIX="$WORK/prefix"
OUT="$ROOT/artifacts"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
CROSS=x86_64-w64-mingw32-

BUILD_X264="${BUILD_X264:-1}"
BUILD_AOM="${BUILD_AOM:-1}"
BUILD_SVT="${BUILD_SVT:-1}"
BUILD_LAME="${BUILD_LAME:-1}"
BUILD_VPL="${BUILD_VPL:-1}"   # Intel QSV
BUILD_NVENC="${BUILD_NVENC:-1}" # NVIDIA NVENC (headers only)
BUILD_AMF="${BUILD_AMF:-1}"   # AMD AMF (headers only)

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# 0. Toolchain
# ---------------------------------------------------------------------------
log "Installing mingw-w64 cross toolchain"
if ! have x86_64-w64-mingw32-gcc; then
  if [ "$(id -u)" -ne 0 ]; then
    sudo apt-get update
    sudo apt-get install -y build-essential git make cmake ninja-build nasm pkg-config \
      autoconf automake libtool yasm \
      gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 mingw-w64-x86-64-dev
  else
    apt-get update
    apt-get install -y build-essential git make cmake ninja-build nasm pkg-config \
      autoconf automake libtool yasm \
      gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 mingw-w64-x86-64-dev
  fi
fi

mkdir -p "$WORK" "$PREFIX" "$OUT"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"

# ---------------------------------------------------------------------------
# External libraries
# ---------------------------------------------------------------------------
fetch() { # name url [ref]
  local name="$1" url="$2" ref="${3:-}"
  [ -d "$WORK/$name" ] && return 0
  if [ -n "$ref" ]; then
    git clone --depth 1 --branch "$ref" "$url" "$WORK/$name"
  else
    git clone --depth 1 "$url" "$WORK/$name"
  fi
}

if [ "$BUILD_X264" = "1" ]; then
  log "Building libx264"
  fetch x264 https://code.videolan.org/videolan/x264.git
  (
    cd "$WORK/x264"
    ./configure --host=x86_64-w64-mingw32 --cross-prefix="$CROSS" \
      --enable-static --disable-cli --disable-shared \
      --prefix="$PREFIX" --extra-cflags="-static-libgcc"
    make -j"$JOBS" && make install
  )
fi

if [ "$BUILD_AOM" = "1" ]; then
  log "Building libaom (AV1)"
  fetch aom https://aomedia.googlesource.com/aom
  # aom dropped its in-tree mingw toolchain file, so pass the cross compiler
  # explicitly (same pattern as the SVT/VPL sections below).
  cmake -S "$WORK/aom" -B "$WORK/aom-build" -G Ninja \
    -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
    -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc \
    -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ \
    -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres \
    -DCMAKE_MAKE_PROGRAM="$(command -v ninja)" \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release \
    -DENABLE_TESTS=0 -DENABLE_DOCS=0 -DENABLE_EXAMPLES=0 -DENABLE_TOOLS=0 \
    -DCONFIG_AV1_ENCODER=1 -DCONFIG_AV1_DECODER=1 -DCONFIG_MULTITHREAD=1
  ninja -C "$WORK/aom-build" && ninja -C "$WORK/aom-build" install
fi

if [ "$BUILD_SVT" = "1" ]; then
  log "Building SVT-AV1"
  # Pin to a release tag: master moves, and a shallow clone has no tags so the
  # generated version header falls back to a bare git hash. v4.2.0 is the
  # current release and satisfies ffmpeg's "SvtAv1Enc >= 0.9.0" check.
  fetch svtav1 https://gitlab.com/AOMediaCodec/SVT-AV1.git v4.2.0
  cmake -S "$WORK/svtav1" -B "$WORK/svt-build" -G Ninja \
    -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
    -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc \
    -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ \
    -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_APPS=OFF -DBUILD_TESTING=OFF -DBUILD_DEC=OFF \
    -DBUILD_SHARED_LIBS=OFF   # static: ffmpeg must not need a sidecar DLL
  ninja -C "$WORK/svt-build" && ninja -C "$WORK/svt-build" install
  # Self-report the exact query ffmpeg's configure will run, so a pkg-config
  # failure here is visible instead of swallowed by ffmpeg's config.log.
  log "Verifying SvtAv1Enc pkg-config query"
  ls -la "$PREFIX/lib/pkgconfig/" | grep -i svt || true
  cat "$PREFIX/lib/pkgconfig/SvtAv1Enc.pc" 2>/dev/null || true
  if pkg-config --exists --print-errors "SvtAv1Enc >= 0.9.0"; then
    echo "SvtAv1Enc pkg-config check: OK (version $(pkg-config --modversion SvtAv1Enc))"
  else
    echo "SvtAv1Enc pkg-config check: FAILED (exit $?)"
  fi
fi

if [ "$BUILD_LAME" = "1" ]; then
  log "Building libmp3lame"
  if [ ! -d "$WORK/lame" ]; then
    curl -fsSL -o "$WORK/lame.tar.gz" \
      https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz
    tar xzf "$WORK/lame.tar.gz" -C "$WORK"
    mv "$WORK/lame-3.100" "$WORK/lame"
  fi
  (
    cd "$WORK/lame"
    ./configure --host=x86_64-w64-mingw32 --enable-static --disable-shared \
      --disable-frontend --disable-decoder --prefix="$PREFIX"
    make -j"$JOBS" && make install
  )
fi

if [ "$BUILD_VPL" = "1" ]; then
  log "Building Intel oneVPL (QSV)"
  fetch oneVPL https://github.com/oneapi-src/oneVPL.git
  cmake -S "$WORK/oneVPL" -B "$WORK/vpl-build" -G Ninja \
    -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
    -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc \
    -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ \
    -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_TOOLS=OFF -DBUILD_TESTS=OFF -DBUILD_EXAMPLES=OFF \
    -DBUILD_SHARED_LIBS=OFF   # ffmpeg links libvpl statically
  ninja -C "$WORK/vpl-build" && ninja -C "$WORK/vpl-build" install
fi

if [ "$BUILD_NVENC" = "1" ]; then
  log "Installing nv-codec-headers (NVENC)"
  fetch nv-codec-headers https://github.com/FFmpeg/nv-codec-headers.git
  ( cd "$WORK/nv-codec-headers" && make install PREFIX="$PREFIX" )
fi

if [ "$BUILD_AMF" = "1" ]; then
  log "Installing AMF headers"
  fetch AMF https://github.com/GPUOpen-LibrariesAndSDKs/AMF.git
  mkdir -p "$PREFIX/include/AMF"
  cp -r "$WORK/AMF/amf/public/include/." "$PREFIX/include/AMF/"
fi

# ---------------------------------------------------------------------------
# FFmpeg — minimal configure
# ---------------------------------------------------------------------------
log "Cloning FFmpeg"
fetch FFmpeg https://github.com/FFmpeg/FFmpeg.git

EXTRA_LIBS=""
CONFIG_EXT=""
[ "$BUILD_X264" = "1" ]  && CONFIG_EXT="$CONFIG_EXT --enable-libx264"
[ "$BUILD_AOM" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-libaom"
[ "$BUILD_SVT" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-libsvtav1"
[ "$BUILD_LAME" = "1" ]  && CONFIG_EXT="$CONFIG_EXT --enable-libmp3lame"
[ "$BUILD_VPL" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-libvpl"
[ "$BUILD_NVENC" = "1" ] && CONFIG_EXT="$CONFIG_EXT --enable-ffnvcodec --enable-nvenc"
[ "$BUILD_AMF" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-amf"
# Static mingw links can need the C++ runtime for SVT/VPL static libs.
EXTRA_LIBS="-lstdc++ -lpthread -static"

# The hardware encoder names are built-in; only the *_nvenc / *_qsv / *_amf
# entries matter, and they require the SDK lines above.
ENCODERS="libx264,libaom_av1,libsvtav1,aac,libmp3lame,mjpeg,rawvideo,pcm_s16le"
[ "$BUILD_NVENC" = "1" ] && ENCODERS="$ENCODERS,h264_nvenc,av1_nvenc"
[ "$BUILD_VPL" = "1" ]   && ENCODERS="$ENCODERS,h264_qsv,av1_qsv"
[ "$BUILD_AMF" = "1" ]   && ENCODERS="$ENCODERS,h264_amf,av1_amf"

log "Configuring FFmpeg (minimal)"
(
  cd "$WORK/FFmpeg"
  if ! ./configure \
    --arch=x86_64 --target-os=mingw32 --cross-prefix="$CROSS" \
    --prefix="$PREFIX" --pkg-config=pkg-config --pkg-config-flags="--static" \
    --enable-gpl --enable-static --disable-shared --enable-w32threads \
    --disable-autodetect --disable-everything \
    --enable-ffmpeg --enable-ffprobe \
    --enable-protocol=file,pipe,concat \
    --enable-demuxer=mov,matroska,avi,flv,mpegts,mpegps,mp3,wav,ogg,image2,gif,m4v,concat \
    --enable-muxer=mp4,mov,matroska,webm,mp3,gif,image2,wav,pcm_s16le,yuv4mpegpipe,avi,flv,mpegts,ogg \
    --enable-decoder=h264,hevc,av1,vp8,vp9,mpeg4,mpeg2video,mjpeg,wmv3,msmpeg4v2,msmpeg4v3,aac,mp3,ac3,eac3,opus,vorbis,flac,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s32le,pcm_u8,pcm_f32le,truehd \
    --enable-encoder="$ENCODERS" \
    --enable-parser=h264,hevc,av1,vp8,vp9,mpeg4video,mpegvideo,mjpeg,aac,mp3,ac3,opus,vorbis,flac,truehd \
    --enable-filter=trim,setpts,scale,crop,fps,format,split,concat,overlay,pad,null,anull \
    --extra-cflags="-I$PREFIX/include -static-libgcc" \
    --extra-ldflags="-L$PREFIX/lib" \
    --extra-libs="$EXTRA_LIBS" \
    $CONFIG_EXT
  then
    # On failure, dump the pkg-config sections of config.log (the authoritative
    # record) so the CI log shows the real reason instead of the truncated
    # "ERROR: ... not found using pkg-config" line.
    echo "---- ffbuild/config.log: pkg-config / external library failures ----"
    grep -n -A 6 -i "pkg-config\|SvtAv1Enc\|libaom\|libx264\|libmp3lame\|ERROR" ffbuild/config.log | head -120 || true
    exit 1
  fi

  make -j"$JOBS"
)

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
log "Stripping binaries"
"${CROSS}strip" -s "$WORK/FFmpeg/ffmpeg.exe" "$WORK/FFmpeg/ffprobe.exe" 2>/dev/null || true

cp "$WORK/FFmpeg/ffmpeg.exe" "$OUT/ffmpeg.exe"
cp "$WORK/FFmpeg/ffprobe.exe" "$OUT/ffprobe.exe"

echo
echo "Built:"
ls -lh "$OUT/ffmpeg.exe" "$OUT/ffprobe.exe"
echo
echo "Drop these two files into bin/ (replacing the ~98 MB gyan.dev builds) and rebuild the app."
