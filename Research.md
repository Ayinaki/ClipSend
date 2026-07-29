# CLIPSEND: Native Discord Clips Integration Guide

This document outlines the pipeline required to export rendered videos from CLIPSEND directly into Discord's native local Clips gallery.

Discord's background scanner is incredibly strict. It completely ignores standard MP4 metadata (like `comment` or `description` tags) and strictly requires a proprietary binary MP4 atom to be appended to the file. Furthermore, the file must be named using a valid Discord Snowflake ID, or the React UI will crash when trying to parse the date.

This pipeline perfectly mimics Discord's proprietary C++ Media Engine entirely within Node.js, requiring zero external dependencies like Puppeteer or AtomicParsley.

## Pipeline Overview

1. **Snowflake Generation:** Generate a valid Discord Snowflake ID based on the current timestamp.
2. **FFmpeg Rendering:** Render the video and spoof the audio track metadata so Discord's transcoder doesn't mute it.
3. **File Naming:** Save the file to the user's `Documents` folder using the specific `AppName_Snowflake.mp4` format.
4. **Binary Injection:** Use Node's native `Buffer` and `fs` modules to append Discord's hardcoded signature and the JSON payload directly to the end of the MP4.

---

## Step 1: The Snowflake ID

Discord's UI parses the creation date directly from the file name's ID. Using a standard UUID will result in an "Invalid Date" error and immediately crash the app when clicked. You must generate an 18-digit Snowflake.

```javascript
const DISCORD_EPOCH = 1420070400000n;
const timestampMs = BigInt(Date.now());
const snowflakeId = ((timestampMs - DISCORD_EPOCH) << 22n).toString();

```

## Step 2: File Naming & Output Path

The output file must be written to a location Discord actively scans (e.g., the user's `Documents` folder) and must strictly follow the `[ApplicationName]_[SnowflakeID].mp4` format.

```javascript
const appName = "CLIPSEND";
const outputFile = `C:\\Users\\[Username]\\Documents\\${appName}_${snowflakeId}.mp4`;

```

## Step 3: FFmpeg Audio Routing

Discord's sharing transcoder ignores standard audio tracks. To ensure audio plays when the user actually shares the clip in a channel, you must append this specific metadata flag to your FFmpeg export command to rename the primary audio stream:

`-metadata:s:a:0 title="LocalApplication:application"`

**Example Command:**

```bash
ffmpeg -i raw_video.mp4 -c copy -metadata:s:a:0 title="LocalApplication:application" final_clip.mp4

```

## Step 4: Binary Payload Injection

This is the core bypass. Discord uses a static, universal 16-byte hex signature (`a1c8529933464db888f083f57a75a5ef`) for every single clip. We construct a standard MP4 `uuid` box header containing this signature, and append it along with our JSON payload directly to the end of the file.

### The JSON Schema Rules

* `id`: Must perfectly match the generated Snowflake.
* `filepath`: Must be the absolute path to the newly rendered file.
* `length`: Total duration in exact milliseconds.
* `editMetadata.end`: Total duration in exact seconds.
* `activity.timestamps.start`: Should align with the Snowflake generation time.

### The Native Integration Code

Drop this immediately after your FFmpeg render promise resolves.

```javascript
const fs = require('fs');

// 1. Prepare the JSON Payload
const clipMetadata = {
  "id": snowflakeId, // From Step 1
  "version": 4,
  "applicationName": appName,
  "applicationId": "YOUR_DISCORD_APP_ID", // Optional: Links to a Rich Presence app
  "filepath": outputFile,
  "type": "clip",
  "activity": {
    "timestamps": { "start": Date.now() }
  },
  "users": [], // Populate if tracking specific Discord user IDs in the clip
  "clipMethod": "manual",
  "isTemporary": false,
  "guildId": "", // Optional
  "channelId": "", // Optional
  "timeline": [
    { "signal": { "type": "manual" }, "timestamp": Date.now() }
  ],
  "decision": {
    "signal": { "type": "manual" },
    "timestamp": Date.now(),
    "emotionHistory": []
  },
  "length": 7420, // Milliseconds (Dynamically map this to your video)
  "thumbnail": "data:image/jpeg;base64,...", // Optional: 1x1 black JPEG or real frame
  "editMetadata": {
    "start": 0,
    "end": 7.42, // Seconds (Dynamically map this to your video)
    "voiceAudio": true,
    "applicationAudio": true,
    "soundboardAudio": true
  }
};

// 2. Convert to Buffers
const jsonString = JSON.stringify(clipMetadata);
const jsonBuffer = Buffer.from(jsonString, 'utf-8');

// Discord's Hardcoded 16-byte Signature
const discordUuidHex = "a1c8529933464db888f083f57a75a5ef";
const uuidBuffer = Buffer.from(discordUuidHex, 'hex');

// 3. Construct the MP4 Atom Header
// 4 bytes (Size) + 4 bytes ('uuid') + 16 bytes (UUID) = 24 bytes
const boxSize = 24 + jsonBuffer.length; 
const boxHeader = Buffer.alloc(24);

boxHeader.writeUInt32BE(boxSize, 0);       
boxHeader.write('uuid', 4);                
uuidBuffer.copy(boxHeader, 8);             

// 4. Append to the MP4
fs.appendFileSync(outputFile, boxHeader);
fs.appendFileSync(outputFile, jsonBuffer);

```