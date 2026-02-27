import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeJobJsonOutput, writeSelectedOutputs } from './writers';

const makeTempOutputDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'transcripter-writers-'));

test('writeSelectedOutputs writes transcript and subtitle files into dedicated folders', async () => {
  const outputDirectory = await makeTempOutputDir();

  const filesWritten = await writeSelectedOutputs({
    outputDirectory,
    baseName: 'example-video',
    outputOptions: { txt: true, timecodedTxt: true, srt: true, vtt: false, json: false },
    segments: [{ start: 0, end: 1.5, text: ' hello   world ' }],
    transcriptText: 'fallback text'
  });

  assert.deepEqual(
    filesWritten.map((filePath) => path.relative(outputDirectory, filePath).replaceAll(path.sep, '/')).sort(),
    ['subtitles/example-video.srt', 'transcripts/example-video.txt', 'transcripts/example-video_timecoded.txt']
  );
});

test('writeJobJsonOutput always writes segments and relative output paths', async () => {
  const outputDirectory = await makeTempOutputDir();

  const jobJsonPath = await writeJobJsonOutput({
    outputDirectory,
    baseName: 'example-video',
    source: {
      fileName: 'example-video.mp4',
      originalPath: '/tmp/example-video.mp4',
      durationSeconds: 42.5
    },
    settings: {
      model: 'base',
      language: 'en',
      timestamps: true,
      outputOptions: { txt: true, timecodedTxt: false, srt: true, vtt: false, json: false }
    },
    outputs: {
      txtPath: 'transcripts/example-video.txt',
      srtPath: 'subtitles/example-video.srt',
      vttPath: null,
      timecodedTxtPath: null
    },
    transcript: {
      rawText: '  hello\nworld  ',
      segments: [{ start: 0, end: 1.5, text: ' hello   world ' }]
    },
    status: 'completed',
    transcripterVersion: '0.1.0',
    jobId: 'job-123',
    createdAt: '2025-01-01T00:00:00.000Z'
  });

  const payload = JSON.parse(await fs.readFile(jobJsonPath, 'utf8')) as {
    transcript: { rawText: string; segments: Array<{ start: number; end: number; text: string }> };
    outputs: { txtPath: string | null; srtPath: string | null };
    status: string;
    source: { fileName: string; durationSeconds: number };
  };

  assert.equal(payload.status, 'completed');
  assert.equal(payload.source.fileName, 'example-video.mp4');
  assert.equal(payload.source.durationSeconds, 42.5);
  assert.equal(payload.outputs.txtPath, 'transcripts/example-video.txt');
  assert.equal(payload.outputs.srtPath, 'subtitles/example-video.srt');
  assert.equal(payload.transcript.rawText, 'hello world');
  assert.deepEqual(payload.transcript.segments, [{ start: 0, end: 1.5, text: 'hello world' }]);
});
