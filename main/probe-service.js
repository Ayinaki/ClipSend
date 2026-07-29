const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

let ffprobePath = path.join(__dirname, '..', 'bin', 'ffprobe.exe');
if (ffprobePath.includes('app.asar')) {
  ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
}
let ffmpegPath = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
if (ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

function runFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ffprobePath)) {
      return reject(new Error(`ffprobe not found at ${ffprobePath}. Please ensure the bundled binaries are present.`));
    }

    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath
    ];

    execFile(ffprobePath, args, { maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`ffprobe error: ${error.message}\nstderr: ${stderr}`));
      }
      try {
        const data = JSON.parse(stdout);
        resolve(data);
      } catch (parseError) {
        reject(new Error('Failed to parse ffprobe output'));
      }
    });
  });
}

async function probeFile(filePath) {
  const rawData = await runFfprobe(filePath);
  
  const format = rawData.format;
  const videoStream = rawData.streams.find(s => s.codec_type === 'video');
  const audioStreams = rawData.streams.filter(s => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('No video stream found in file');
  }

  // Parse duration
  let duration = parseFloat(format.duration);
  if (isNaN(duration) && videoStream.duration) {
    duration = parseFloat(videoStream.duration);
  }

  // Parse frame rate and detect VFR
  let frameRate = 0;
  let isVFR = false;
  if (videoStream.r_frame_rate) {
    const parts = videoStream.r_frame_rate.split('/');
    if (parts.length === 2) {
      frameRate = parseInt(parts[0], 10) / parseInt(parts[1], 10);
    } else {
      frameRate = parseFloat(videoStream.r_frame_rate);
    }
    
    // VFR detection: if average frame rate significantly differs from base frame rate
    if (videoStream.avg_frame_rate && videoStream.avg_frame_rate !== videoStream.r_frame_rate) {
      // 0/0 is common for some broken files, ignore that
      if (videoStream.avg_frame_rate !== '0/0') {
        isVFR = true;
      }
    }
  }

  const mediaInfo = {
    filePath: filePath,
    duration: duration,
    frameRate: frameRate,
    isVFR: isVFR,
    width: videoStream.width,
    height: videoStream.height,
    videoCodec: videoStream.codec_name,
    fileSize: parseInt(format.size, 10),
    audioTracks: audioStreams.map((s, index) => ({
      audioOrdinal: index,
      streamIndex: s.index,
      codec: s.codec_name,
      channels: s.channels,
      language: s.tags && s.tags.language ? s.tags.language : 'und',
      title: s.tags && s.tags.title ? s.tags.title : ''
    }))
  };

  return mediaInfo;
}

async function extractThumbnail(filePath, tempDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ffmpegPath)) {
      return reject(new Error(`ffmpeg not found at ${ffmpegPath}`));
    }
    
    const tempName = `thumb-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;
    const outputPath = path.join(tempDir, tempName);
    
    const args = [
      '-y',
      '-ss', '00:00:01.000',
      '-i', filePath,
      '-vframes', '1',
      '-vf', 'scale=160:-1',
      '-q:v', '5',
      outputPath
    ];
    
    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (fs.existsSync(outputPath)) {
        resolve(`file:///${outputPath.replace(/\\/g, '/')}`);
      } else {
        const argsFallback = [
          '-y',
          '-ss', '00:00:00.000',
          '-i', filePath,
          '-vframes', '1',
          '-vf', 'scale=160:-1',
          '-q:v', '5',
          outputPath
        ];
        execFile(ffmpegPath, argsFallback, { maxBuffer: 10 * 1024 * 1024 }, (error2) => {
          if (fs.existsSync(outputPath)) {
            resolve(`file:///${outputPath.replace(/\\/g, '/')}`);
          } else {
            resolve(null);
          }
        });
      }
    });
  });
}

module.exports = { probeFile, extractThumbnail };
