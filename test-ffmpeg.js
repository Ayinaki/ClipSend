const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ffmpegPath = path.join(__dirname, 'bin', 'ffmpeg.exe');

async function testFFmpeg() {
  const cwd = path.join(__dirname, 'test_tmp');
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd);

  // create a dummy input video
  console.log('creating dummy video...');
  const dummyVid = path.join(cwd, 'dummy.mp4');
  await new Promise((resolve) => {
    const p = spawn(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1280x720:rate=30',
      '-c:v', 'libx264', dummyVid
    ]);
    p.on('close', resolve);
  });

  console.log('running pass 1...');
  const pass1 = spawn(ffmpegPath, [
    '-y',
    '-i', dummyVid,
    '-map', '0:v:0',
    '-c:v', 'libx264',
    '-b:v', '1000k',
    '-pix_fmt', 'yuv420p',
    '-preset', 'slow',
    '-pass', '1',
    '-passlogfile', 'mypass',
    '-an',
    '-f', 'null',
    'NUL'
  ], { cwd });
  
  pass1.stderr.on('data', d => console.log('1> ' + d.toString().trim()));
  
  await new Promise(r => pass1.on('close', r));
  
  console.log('pass 1 done. log exists?', fs.existsSync(path.join(cwd, 'mypass-0.log')));

  console.log('running pass 2...');
  const pass2 = spawn(ffmpegPath, [
    '-y',
    '-i', dummyVid,
    '-map', '0:v:0',
    '-c:v', 'libx264',
    '-b:v', '1000k',
    '-pix_fmt', 'yuv420p',
    '-preset', 'slow',
    '-pass', '2',
    '-passlogfile', 'mypass',
    'out.mp4'
  ], { cwd });

  pass2.stderr.on('data', d => console.log('2> ' + d.toString().trim()));
  await new Promise(r => pass2.on('close', r));
  console.log('pass 2 done.');
}

testFFmpeg().catch(console.error);
