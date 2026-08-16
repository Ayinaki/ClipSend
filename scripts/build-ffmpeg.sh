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
#   encoders : libx264, libaom-av1, libsvtav1, libvpx-vp9 (WebM), aac, opus
#              (native, WebM audio), libmp3lame, mjpeg (thumbs), png (gif
#              palette, needs --enable-zlib), gif (merged gif output),
#              wrapped_avframe (yuv4mpegpipe default), rawvideo (gifski y4m),
#              pcm_s16le (waveform), h264/av1 nvenc + qsv + amf (hardware)
#   muxers   : mp4/mov (+faststart), matroska/webm, mp3, gif, image2, wav,
#              pcm_s16le, yuv4mpegpipe, avi, flv, mpegts, ogg, null (2-pass pass1)
#   demuxers : mov, matroska, avi, flv, mpegts, mpegps, mp3, wav, ogg, image2,
#              gif, m4v
#   decoders : h264/hevc/vp8/vp9/mpeg4/mpeg2video/mjpeg/png/wmv3/msmpeg4,
#              aac/mp3/ac3/eac3/opus/vorbis/flac/alac/truehd/pcm_*,
#              libdav1d (software AV1 decode) + av1 (HW-only, see below)
#   filters  : trim, setpts, atempo, scale, crop, fps, format, split, concat,
#              overlay, pad, null, anull, aresample, aformat, anullsrc,
#              palettegen, paletteuse, setsar
#   protocols: file, pipe, concat
#
#   AV1 DECODE: current FFmpeg master's native 'av1' decoder refuses software
#   decode ("Your platform doesn't support hardware accelerated AV1 decoding"
#   when no hwaccel initializes — the get_pixel_format() loop below never
#   tests the trailing software format), so libdav1d is the ONLY software AV1
#   decode path. Without it, AV1 clips silently fail everywhere: merge
#   thumbnails, trims, and re-encodes. libdav1d registers before the native
#   decoder, so the CLI auto-selects it — no app-side changes needed.
#
# Usage (in CI or locally on Linux):
#   bash scripts/build-ffmpeg.sh
# Outputs:
#   artifacts/ffmpeg.exe
#   artifacts/ffprobe.exe
#
# Each external dependency can be skipped with an env flag so a troublesome
# one doesn't sink the whole build (e.g. BUILD_VPL=0 drops QSV support):
#   BUILD_X264 BUILD_AOM BUILD_SVT BUILD_DAV1D BUILD_LAME BUILD_VPL
#   BUILD_NVENC BUILD_AMF
# Default: all on.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.ffbuild"
PREFIX="$WORK/prefix"
OUT="$ROOT/artifacts"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 4)}"
# libvpx's configure.sh reads its toolchain from the CROSS env var (the other
# deps take an explicit flag), so this must be exported - not just set - or
# libvpx silently builds ELF objects with the host gcc and ffmpeg's configure
# disables the VP9 encoder.
export CROSS=x86_64-w64-mingw32-

BUILD_X264="${BUILD_X264:-1}"
BUILD_AOM="${BUILD_AOM:-1}"
BUILD_SVT="${BUILD_SVT:-1}"
BUILD_DAV1D="${BUILD_DAV1D:-1}" # software AV1 decode (native av1 decoder is HW-only)
BUILD_LAME="${BUILD_LAME:-1}"
BUILD_VPX="${BUILD_VPX:-1}"     # VP8/VP9 (WebM export)
BUILD_VPL="${BUILD_VPL:-1}"     # Intel QSV
BUILD_NVENC="${BUILD_NVENC:-1}" # NVIDIA NVENC (headers only)
BUILD_AMF="${BUILD_AMF:-1}"     # AMD AMF (headers only)

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
die()  { echo "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Toolchain
# ---------------------------------------------------------------------------
log "Installing mingw-w64 cross toolchain"
if ! have x86_64-w64-mingw32-gcc; then
  if [ "$(id -u)" -ne 0 ]; then
    sudo apt-get update
    sudo apt-get install -y build-essential git make cmake ninja-build nasm meson pkg-config wine64 \
      autoconf automake libtool yasm \
      gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 mingw-w64-x86-64-dev libz-mingw-w64-dev
  else
    apt-get update
    apt-get install -y build-essential git make cmake ninja-build nasm meson pkg-config wine64 \
      autoconf automake libtool yasm \
      gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 mingw-w64-x86-64-dev libz-mingw-w64-dev
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
  # videolan.org's git server is unreachable from GitHub runners; use the
  # GitHub mirror (x264 is stable - the 2024 mirror is current enough).
  fetch x264 https://github.com/mirror/x264.git
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
  # Pin to a release tag: aom master already broke this build once (the in-tree
  # mingw toolchain file was removed). v3.9.1 is the current release.
  fetch aom https://aomedia.googlesource.com/aom v3.9.1
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

if [ "$BUILD_DAV1D" = "1" ]; then
  log "Building libdav1d (software AV1 decode)"
  # Pin to a release tag on the GitHub mirror (code.videolan.org is
  # unreachable from GitHub runners). dav1d is pure C and static-only, so the
  # cross build is just meson + ninja with a small cross file.
  fetch dav1d https://github.com/videolan/dav1d.git 1.5.4
  cat > "$WORK/dav1d-cross.txt" <<EOF
[binaries]
c = '${CROSS}gcc'
ar = '${CROSS}ar'
strip = '${CROSS}strip'
windres = '${CROSS}windres'

[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
EOF
  meson setup "$WORK/dav1d-build" "$WORK/dav1d" \
    --cross-file="$WORK/dav1d-cross.txt" \
    --prefix="$PREFIX" --buildtype=release \
    --default-library=static \
    -Denable_tools=false -Denable_tests=false
  ninja -C "$WORK/dav1d-build" && ninja -C "$WORK/dav1d-build" install
  if pkg-config --exists --print-errors "dav1d >= 1.0"; then
    echo "dav1d pkg-config check: OK (version $(pkg-config --modversion dav1d))"
  else
    echo "dav1d pkg-config check: FAILED (exit $?)"
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

if [ "$BUILD_VPX" = "1" ]; then
  log "Building libvpx (VP8/VP9)"
  # Pin to a release tag (CHANGELOG "v1.14.1 \"Venetian Duck\""). libvpx has
  # its own configure (not autotools); unlike the other deps it reads its
  # toolchain from the CROSS env var rather than an explicit flag, so pass it
  # directly. The mingw cross target builds a static libvpx.a that ffmpeg
  # links; tools/tests/examples are all dropped.
  fetch libvpx https://github.com/webmproject/libvpx.git v1.14.1
  (
    cd "$WORK/libvpx"
    CROSS="$CROSS" ./configure --target=x86_64-win64-gcc --prefix="$PREFIX" \
      --enable-static --disable-shared \
      --disable-examples --disable-docs --disable-tools --disable-unit-tests \
      --disable-webm-io --disable-libyuv
    make -j"$JOBS" && make install
  )

  # Self-report the exact query ffmpeg's configure will run for libvpx (mirrors
  # the SvtAv1Enc diagnostic above), then prove the archive actually links for
  # the Windows target - without CROSS above, libvpx silently builds ELF
  # objects with the host gcc and ffmpeg's configure disables libvpx_vp9_encoder.
  log "Verifying vpx pkg-config query"
  ls -la "$PREFIX/lib/pkgconfig/" | grep -i vpx || true
  cat "$PREFIX/lib/pkgconfig/vpx.pc" 2>/dev/null || true
  if pkg-config --exists --print-errors "vpx >= 1.4.0"; then
    echo "vpx pkg-config check: OK (version $(pkg-config --modversion vpx))"
    echo "cflags: $(pkg-config --cflags --static vpx 2>&1)"
    echo "libs:   $(pkg-config --libs --static vpx 2>&1)"
  else
    echo "vpx pkg-config check: FAILED (exit $?)"
  fi

  log "Verifying libvpx links for the Windows target"
  cat > "$WORK/vpx-check.c" <<'EOF'
#include <vpx/vpx_encoder.h>
#include <vpx/vp8cx.h>
#include <stdint.h>
long check_vpx_codec_vp9_cx(void) { return (long) vpx_codec_vp9_cx; }
long check_VPX_IMG_FMT_HIGHBITDEPTH(void) { return (long) VPX_IMG_FMT_HIGHBITDEPTH; }
int main(void) { int ret = 0;
  ret |= ((intptr_t)check_vpx_codec_vp9_cx) & 0xFFFF;
  ret |= ((intptr_t)check_VPX_IMG_FMT_HIGHBITDEPTH) & 0xFFFF;
  return ret; }
EOF
  x86_64-w64-mingw32-gcc -I"$PREFIX/include" -static-libgcc \
    "$WORK/vpx-check.c" -o "$WORK/vpx-check.exe" \
    -L"$PREFIX/lib" -lvpx -lm -lpthread -lstdc++ -static \
    || die "libvpx archive is not linkable for the Windows target (see error above)"
  echo "libvpx link check: OK"
fi

if [ "$BUILD_VPL" = "1" ]; then
  log "Building Intel oneVPL (QSV)"
  # Pin to the current release tag; master drifts and QSV is already the most
  # fragile cross-build step.
  fetch oneVPL https://github.com/oneapi-src/oneVPL.git v2023.4.0
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

# Patch the off-by-one in av1dec.c's get_pixel_format() so the native AV1
# decoder's software path actually works. The early "already-decided format"
# loop exits at `pix_fmts[i] == pix_fmt` WITHOUT testing that element — and
# the software format is always the last element — so software AV1 decode
# always fell through to the "no hwaccel -> ENOSYS" error. Test every element
# up to the AV_PIX_FMT_NONE terminator instead. (libdav1d is auto-selected for
# AV1 inputs, so this is a fallback for -c:v av1 and BUILD_DAV1D=0 builds.)
log "Patching av1dec.c software-decode fallback"
sed -i 's/pix_fmts\[i\] != pix_fmt/pix_fmts[i] != AV_PIX_FMT_NONE/' "$WORK/FFmpeg/libavcodec/av1dec.c"
grep -q "pix_fmts\[i\] != AV_PIX_FMT_NONE" "$WORK/FFmpeg/libavcodec/av1dec.c" || die "av1dec.c patch failed to apply"

EXTRA_LIBS=""
CONFIG_EXT=""
[ "$BUILD_X264" = "1" ]  && CONFIG_EXT="$CONFIG_EXT --enable-libx264"
[ "$BUILD_AOM" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-libaom"
[ "$BUILD_SVT" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-libsvtav1"
[ "$BUILD_DAV1D" = "1" ] && CONFIG_EXT="$CONFIG_EXT --enable-libdav1d"
[ "$BUILD_LAME" = "1" ]  && CONFIG_EXT="$CONFIG_EXT --enable-libmp3lame"
[ "$BUILD_VPX" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-libvpx"
[ "$BUILD_VPL" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-libvpl"
[ "$BUILD_NVENC" = "1" ] && CONFIG_EXT="$CONFIG_EXT --enable-ffnvcodec --enable-nvenc"
[ "$BUILD_AMF" = "1" ]   && CONFIG_EXT="$CONFIG_EXT --enable-amf"
# Static mingw links can need the C++ runtime for SVT/VPL static libs.
EXTRA_LIBS="-lstdc++ -lpthread -static"

# The hardware encoder names are built-in; only the *_nvenc / *_qsv / *_amf
# entries matter, and they require the SDK lines above. libvpx_vp9 (the WebM
# video encoder) is appended conditionally because it needs --enable-libvpx;
# `opus` is FFmpeg's native Opus encoder (no external lib — the slim build
# deliberately avoids linking libopus). It is flagged experimental, so the
# planner appends `-strict -2` for WebM audio.
ENCODERS="libx264,libaom_av1,libsvtav1,aac,libmp3lame,mjpeg,png,gif,wrapped_avframe,rawvideo,pcm_s16le,opus"
[ "$BUILD_VPX" = "1" ]   && ENCODERS="$ENCODERS,libvpx_vp9"
[ "$BUILD_NVENC" = "1" ] && ENCODERS="$ENCODERS,h264_nvenc,av1_nvenc"
[ "$BUILD_VPL" = "1" ]   && ENCODERS="$ENCODERS,h264_qsv,av1_qsv"
[ "$BUILD_AMF" = "1" ]   && ENCODERS="$ENCODERS,h264_amf,av1_amf"

# --disable-everything drops every decoder, so the software AV1 path must be
# named here too — --enable-libdav1d alone links the lib but never registers
# the libdav1d decoder component (caught by the post-build assertion).
DECODERS="h264,hevc,av1,vp8,vp9,mpeg4,mpeg2video,mjpeg,png,wmv3,msmpeg4v2,msmpeg4v3,aac,mp3,ac3,eac3,opus,vorbis,flac,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s32le,pcm_u8,pcm_f32le,truehd"
[ "$BUILD_DAV1D" = "1" ] && DECODERS="$DECODERS,libdav1d"

log "Configuring FFmpeg (minimal)"
(
  cd "$WORK/FFmpeg"
  if ! ./configure \
    --arch=x86_64 --target-os=mingw32 --cross-prefix="$CROSS" \
    --prefix="$PREFIX" --pkg-config=pkg-config --pkg-config-flags="--static" \
    --enable-gpl --enable-static --disable-shared --enable-w32threads \
    --disable-autodetect --disable-everything --enable-zlib \
    --enable-ffmpeg --enable-ffprobe \
    --enable-protocol=file,pipe,concat \
    --enable-demuxer=mov,matroska,avi,flv,mpegts,mpegps,mp3,wav,ogg,image2,gif,m4v,concat \
    --enable-muxer=mp4,mov,matroska,webm,mp3,gif,image2,wav,pcm_s16le,yuv4mpegpipe,avi,flv,mpegts,ogg,null \
    --enable-decoder="$DECODERS" \
    --enable-encoder="$ENCODERS" \
    --enable-parser=h264,hevc,av1,vp8,vp9,mpeg4video,mpegvideo,mjpeg,aac,mp3,ac3,opus,vorbis,flac,truehd \
    --enable-filter=trim,setpts,atempo,scale,crop,fps,format,split,concat,overlay,pad,null,anull,aresample,aformat,anullsrc,palettegen,paletteuse,setsar \
    --extra-cflags="-I$PREFIX/include -static-libgcc" \
    --extra-ldflags="-L$PREFIX/lib" \
    --extra-libs="$EXTRA_LIBS" \
    $CONFIG_EXT
  then
    # On failure, dump the pkg-config sections of config.log (the authoritative
    # record) so the CI log shows the real reason instead of the truncated
    # "ERROR: ... not found using pkg-config" line.
    echo "---- ffbuild/config.log: pkg-config / external library failures ----"
    grep -n -A 6 -i "pkg-config\|SvtAv1Enc\|libaom\|libx264\|libmp3lame\|libvpx\|libdav1d\|ERROR" ffbuild/config.log | head -120 || true
    exit 1
  fi

  # Configure succeeded, but --disable-everything silently drops any component
  # whose check failed (e.g. the libvpx encoders). Surface those checks so a
  # disabled libvpx_vp9 is diagnosable from the CI log rather than only by the
  # post-build assertion.
  echo "---- ffbuild/config.log: libvpx / vpx checks ----"
  grep -n -i -B 1 -A 8 "libvpx\|vpx_codec\|vpx >= \|vpx/vpx" ffbuild/config.log | head -100 || true

  make -j"$JOBS"
)

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
log "Stripping binaries"
"${CROSS}strip" -s "$WORK/FFmpeg/ffmpeg.exe" "$WORK/FFmpeg/ffprobe.exe" 2>/dev/null || true

cp "$WORK/FFmpeg/ffmpeg.exe" "$OUT/ffmpeg.exe"
cp "$WORK/FFmpeg/ffprobe.exe" "$OUT/ffprobe.exe"

# ---------------------------------------------------------------------------
# Post-build assertion: every component the app uses must be present.
# --disable-everything silently drops anything whose name doesn't match the
# configure flag (e.g. 's16le' vs 'pcm_s16le') or whose deps are missing
# (e.g. png without zlib). This check turns those silent drops into a hard
# build failure instead of a runtime surprise.
#
# The Windows exe can't execute on this Linux host, so the checks run under
# wine (installed above). If wine is somehow unavailable, warn and skip -
# shipping unvalidated is preferable to a build that can never finish, but
# every CI run is expected to have wine and therefore to run these.
# ---------------------------------------------------------------------------
log "Asserting required components are present"
FF="$OUT/ffmpeg.exe"
if have wine; then
  RUN_FF="wine"
  export WINEDEBUG=-all
elif have wine64; then
  RUN_FF="wine64"
  export WINEDEBUG=-all
else
  RUN_FF=""
  echo "WARNING: wine not available - skipping post-build component assertions"
fi

if [ -n "$RUN_FF" ]; then
  require_encoder()  { $RUN_FF "$FF" -hide_banner -encoders 2>&1 | grep -qE " $1 " || die "missing encoder: $1"; }
  require_decoder()  { $RUN_FF "$FF" -hide_banner -decoders 2>&1 | grep -qE " $1 " || die "missing decoder: $1"; }
  require_muxer()    { $RUN_FF "$FF" -hide_banner -muxers 2>&1 | grep -qE " $1 " || die "missing muxer: $1"; }
  # Demuxers list comma-joined aliases (e.g. 'mov,mp4,m4a,3gp'): match by
  # comma-or-space-delimited token so any alias counts.
  require_demuxer()  { $RUN_FF "$FF" -hide_banner -demuxers 2>&1 | grep -qE "(^|[ ,])$1([ ,]|$)" || die "missing demuxer: $1"; }
  require_filter()   { $RUN_FF "$FF" -hide_banner -filters 2>&1 | grep -qE "^ .. [A-Z]* *$1 " || die "missing filter: $1"; }

  for e in libx264 libaom-av1 libsvtav1 aac libmp3lame mjpeg png gif wrapped_avframe pcm_s16le; do
    require_encoder "$e"
  done
  [ "$BUILD_VPX" = "1" ]   && { require_encoder libvpx-vp9; require_encoder opus; }
  [ "$BUILD_NVENC" = "1" ] && { require_encoder h264_nvenc; require_encoder av1_nvenc; }
  [ "$BUILD_VPL" = "1" ]   && { require_encoder h264_qsv; require_encoder av1_qsv; }
  [ "$BUILD_AMF" = "1" ]   && { require_encoder h264_amf; require_encoder av1_amf; }

  # AV1 decode: libdav1d is the software path (the native 'av1' decoder is
  # HW-only in current master). Require the decoder, not the lib, so a dav1d
  # build failure surfaces here loudly instead of shipping silently-broken AV1.
  for d in h264 hevc av1 vp8 vp9 mpeg4 mpeg2video mjpeg png aac mp3 ac3 eac3 opus vorbis flac alac truehd; do
    require_decoder "$d"
  done
  [ "$BUILD_DAV1D" = "1" ] && require_decoder libdav1d

  for m in mp4 mov matroska webm mp3 gif image2 wav s16le yuv4mpegpipe avi flv mpegts ogg null; do
    require_muxer "$m"
  done
  for d in mov matroska avi flv mpegts mpeg m4v concat; do
    require_demuxer "$d"
  done
  for f in trim setpts atempo scale crop fps format split concat overlay pad null anull aresample aformat anullsrc palettegen paletteuse setsar; do
    require_filter "$f"
  done

  log "All required components present"
fi

echo
echo "Built:"
ls -lh "$OUT/ffmpeg.exe" "$OUT/ffprobe.exe"
echo
echo "Drop these two files into bin/ (replacing the ~98 MB gyan.dev builds) and rebuild the app."
