import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

export default async (req, res) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the incoming form data (video + settings)
    const { videoBase64, settings } = req.body;

    if (!videoBase64 || !settings) {
      return res.status(400).json({ error: 'Missing video or settings' });
    }

    // Create temp directory for processing
    const tempDir = path.join(os.tmpdir(), `vibshift-${Date.now()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const inputPath = path.join(tempDir, 'input.mp4');
    const outputPath = path.join(tempDir, 'output.mp4');

    // Write base64 video to temp file
    const buffer = Buffer.from(videoBase64, 'base64');
    fs.writeFileSync(inputPath, buffer);

    // Build FFmpeg filter string based on settings
    let filters = [];

    // Trim filter (if start/end times provided)
    if (settings.trimStart !== undefined || settings.trimEnd !== undefined) {
      // Trim is handled via -ss and -to flags, not filters
    }

    // Rotation filter
    if (settings.rotationAngle && settings.rotationAngle !== 0) {
      const radians = (settings.rotationAngle * Math.PI) / 180;
      filters.push(`rotate=${radians}`);
    }

    // Motion artifact effect (creates a subtle zoom/scale cycling based on motion range)
    if (settings.cycleDuration && settings.motionRangeMin !== undefined && settings.motionRangeMax !== undefined) {
      const rangeMin = settings.motionRangeMin || 0;
      const rangeMax = settings.motionRangeMax || 5;
      const cycleSecs = settings.cycleDuration || 1;
      // Scale based on motion range: cycles through zoom levels
      const scaleExpr = `1 + ((${rangeMax - rangeMin} / 200) * sin(2 * PI * t / ${cycleSecs}))`;
      filters.push(`scale=iw*${scaleExpr}:ih*${scaleExpr}`);
    }

    // Build FFmpeg command
    let ffmpegCmd = `ffmpeg -i "${inputPath}"`;

    // Add trim if specified
    if (settings.trimStart !== undefined) {
      ffmpegCmd += ` -ss ${settings.trimStart}`;
    }
    if (settings.trimEnd !== undefined) {
      ffmpegCmd += ` -to ${settings.trimEnd}`;
    }

    // Add filters if any
    if (filters.length > 0) {
      ffmpegCmd += ` -vf "${filters.join(',')}"`;
    }

    // Output settings: h264 codec, reasonable bitrate for file size
    ffmpegCmd += ` -c:v libx264 -preset fast -crf 28 -c:a aac -b:a 128k "${outputPath}"`;

    console.log('Running FFmpeg:', ffmpegCmd);

    // Execute FFmpeg (timeout: 9 seconds for free tier safety)
    try {
      await execAsync(ffmpegCmd, { timeout: 9000, maxBuffer: 50 * 1024 * 1024 });
    } catch (err) {
      console.error('FFmpeg error:', err.message);
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
      return res.status(500).json({
        error: 'Video processing failed',
        details: err.message,
        hint: 'Free tier has a 10-second timeout. Upgrade to Pro for longer videos.'
      });
    }

    // Read processed video
    const outputBuffer = fs.readFileSync(outputPath);
    const outputBase64 = outputBuffer.toString('base64');

    // Cleanup temp files
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Return processed video as base64
    res.status(200).json({
      success: true,
      videoBase64: outputBase64,
      filename: 'VibeShift_Video.mp4'
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({
      error: 'Unexpected error during processing',
      details: err.message
    });
  }
};
