import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { __testables, parseTranscriptFile, splitPodcastTranscripts } from './podcast-splitter';

const makeTempDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'transcripter-podcast-splitter-'));

test('parseTranscriptFile loads .txt and synthesizes segments', async () => {
  const dir = await makeTempDir();
  const txtPath = path.join(dir, 'conversation.txt');
  await fs.writeFile(txtPath, 'Hello there. This is a test transcript. We are checking parsing.', 'utf8');

  const parsed = await parseTranscriptFile(txtPath);
  assert.equal(parsed.fileName, 'conversation.txt');
  assert.ok(parsed.rawText.length > 0);
  assert.ok(parsed.segments.length >= 2);
});

test('parseTranscriptFile loads .job.json transcript payload', async () => {
  const dir = await makeTempDir();
  const jsonPath = path.join(dir, 'sample.job.json');
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        transcript: {
          rawText: 'A short transcript block',
          segments: [
            { start: 0, end: 12, text: 'A short transcript block' },
            { start: 12, end: 26, text: 'Second segment.' }
          ]
        }
      },
      null,
      2
    ),
    'utf8'
  );

  const parsed = await parseTranscriptFile(jsonPath);
  assert.equal(parsed.fileName, 'sample.job.json');
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.rawText, 'A short transcript block');
});

test('duration enforcement splits chunks exceeding hard max', () => {
  const segments = [
    { start: 0, end: 150, text: 'a' },
    { start: 150, end: 300, text: 'b' },
    { start: 300, end: 450, text: 'c' },
    { start: 450, end: 600, text: 'd' }
  ];

  const ranges = __testables.enforceDurationPolicy([{ startIndex: 0, endIndex: 3 }], segments, {
    softMinSec: 180,
    softMaxSec: 360,
    hardMinSec: 120,
    hardMaxSec: 420
  });

  assert.ok(ranges.length >= 2);
  for (const range of ranges) {
    const duration = segments[range.endIndex].end - segments[range.startIndex].start;
    assert.ok(duration <= 420);
  }
});

test('splitPodcastTranscripts falls back and writes manifest + report', async () => {
  const dir = await makeTempDir();
  const inputPath = path.join(dir, 'input.txt');
  const outputPath = path.join(dir, 'out');
  await fs.writeFile(
    inputPath,
    [
      'Welcome everyone to our show.',
      'Today we will discuss onboarding, process, and weekly operations.',
      'Next topic, we will review metrics and blockers for the quarter.',
      'Finally we will summarize and close.'
    ].join(' '),
    'utf8'
  );

  const result = await splitPodcastTranscripts(
    {
      sourcePaths: [inputPath],
      outputFolderPath: outputPath,
      targetMinMinutes: 0.05,
      targetMaxMinutes: 0.08
    },
    {
      settings: {
        outputDirectory: outputPath,
        language: 'en',
        model: 'base',
        outputOptions: { txt: true, timecodedTxt: true, srt: true, vtt: false, json: true },
        openaiApiKey: ''
      }
    }
  );

  assert.equal(result.failures.length, 0);
  assert.equal(result.successes.length, 1);
  assert.equal(result.successes[0].generationMode, 'fallback');

  const manifestRaw = await fs.readFile(result.successes[0].manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as { chunks: Array<{ textFile: string }> };
  assert.ok(manifest.chunks.length >= 1);

  const reportRaw = await fs.readFile(result.reportPath, 'utf8');
  const report = JSON.parse(reportRaw) as { totalFiles: number; successes: unknown[]; failures: unknown[] };
  assert.equal(report.totalFiles, 1);
  assert.equal(report.successes.length, 1);
  assert.equal(report.failures.length, 0);
});

test('requestAiSplitPlan windows long transcripts before Claude planning', async () => {
  const segments = Array.from({ length: 240 }, (_, index) => ({
    start: index * 15,
    end: index * 15 + 15,
    text: `Segment ${index + 1}.`
  }));

  let fetchCalls = 0;
  const fetchImpl = (async (_url, init) => {
    fetchCalls += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
    const content = body.messages?.[0]?.content ?? "{}";
    const payload = JSON.parse(content) as { units?: Array<unknown> };
    const unitCount = payload.units?.length ?? 0;
    return new Response(
      JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              chunks: [
                {
                  startIndex: 0,
                  endIndex: Math.max(0, unitCount - 1),
                  title: `Window ${fetchCalls}`,
                  summary: 'Window summary'
                }
              ]
            })
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const outcome = await __testables.requestAiSplitPlan(
    segments,
    {
      softMinSec: 180,
      softMaxSec: 360,
      hardMinSec: 120,
      hardMaxSec: 420
    },
    {
      outputDirectory: 'ignored',
      language: 'en',
      model: 'base',
      outputOptions: { txt: true, timecodedTxt: true, srt: true, vtt: false, json: true },
      anthropicApiKey: 'test-key'
    },
    fetchImpl
  );

  assert.equal(outcome.usedWindowing, true);
  assert.ok(fetchCalls > 1);
  assert.ok(outcome.ranges);
  assert.equal(outcome.ranges?.[0]?.startIndex, 0);
  assert.equal(outcome.ranges?.[outcome.ranges.length - 1]?.endIndex, segments.length - 1);
});
