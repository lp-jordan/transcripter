import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { OutputOptions, Segment } from '../types';
import {
  formatClockTimestamp,
  formatSrtTimestamp,
  formatVttTimestamp,
  mergedNormalizedText,
  normalizeSegmentText,
  normalizeText
} from './formatting';

export type OverwritePolicy = 'overwrite' | 'skip-existing';

export type OutputWriteRequest = {
  outputDirectory: string;
  baseName: string;
  outputOptions: OutputOptions;
  segments: Segment[];
  transcriptText: string;
  overwritePolicy?: OverwritePolicy;
};

export type JobJsonWriteRequest = {
  outputDirectory: string;
  baseName: string;
  source: {
    fileName: string;
    originalPath?: string;
    durationSeconds?: number | null;
  };
  settings: {
    model: string;
    language: string;
    timestamps: boolean;
    outputOptions: OutputOptions;
  };
  outputs: {
    txtPath: string | null;
    srtPath: string | null;
    vttPath: string | null;
    timecodedTxtPath: string | null;
  };
  transcript: {
    rawText: string;
    segments: Segment[];
  };
  status: 'completed' | 'failed';
  transcripterVersion: string;
  createdAt?: string;
  jobId?: string;
  error?: {
    message: string;
    code: string;
  };
};

const writeFileWithPolicy = async (filePath: string, content: string, overwritePolicy: OverwritePolicy): Promise<boolean> => {
  if (overwritePolicy === 'skip-existing') {
    try {
      await fs.access(filePath);
      return false;
    } catch {
      // file does not exist; proceed.
    }
  }

  await fs.writeFile(filePath, content, 'utf8');
  return true;
};

const writeFileAtomically = async (filePath: string, content: string): Promise<void> => {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
};

export const writeSelectedOutputs = async ({
  outputDirectory,
  baseName,
  outputOptions,
  segments,
  transcriptText,
  overwritePolicy = 'overwrite'
}: OutputWriteRequest): Promise<string[]> => {
  const filesWritten: string[] = [];
  const normalizedTranscript = segments.length > 0 ? mergedNormalizedText(segments) : normalizeText(transcriptText);

  const transcriptDirectory = path.join(outputDirectory, 'transcripts');
  const subtitleDirectory = path.join(outputDirectory, 'subtitles');

  await fs.mkdir(transcriptDirectory, { recursive: true });
  await fs.mkdir(subtitleDirectory, { recursive: true });

  if (outputOptions.txt) {
    const txtPath = path.join(transcriptDirectory, `${baseName}.txt`);
    const wrote = await writeFileWithPolicy(txtPath, `${normalizedTranscript}\n`, overwritePolicy);
    if (wrote) filesWritten.push(txtPath);
  }

  if (outputOptions.timecodedTxt) {
    const timecodedPath = path.join(transcriptDirectory, `${baseName}_timecoded.txt`);
    const body = segments
      .map((segment) => `[${formatClockTimestamp(segment.start)}] ${normalizeSegmentText(segment)}`)
      .filter((line) => line.trim().length > 0)
      .join('\n');
    const wrote = await writeFileWithPolicy(timecodedPath, `${body}\n`, overwritePolicy);
    if (wrote) filesWritten.push(timecodedPath);
  }

  if (outputOptions.json) {
    const jsonPath = path.join(transcriptDirectory, `${baseName}.json`);
    const jsonContent = JSON.stringify(
      {
        text: normalizedTranscript,
        segments: segments.map((segment) => ({ ...segment, text: normalizeSegmentText(segment) }))
      },
      null,
      2
    );
    const wrote = await writeFileWithPolicy(jsonPath, `${jsonContent}\n`, overwritePolicy);
    if (wrote) filesWritten.push(jsonPath);
  }

  if (outputOptions.srt) {
    const srtPath = path.join(subtitleDirectory, `${baseName}.srt`);
    const body = segments
      .map(
        (segment, index) =>
          `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${normalizeSegmentText(segment)}\n`
      )
      .join('\n');
    const wrote = await writeFileWithPolicy(srtPath, body, overwritePolicy);
    if (wrote) filesWritten.push(srtPath);
  }

  if (outputOptions.vtt) {
    const vttPath = path.join(subtitleDirectory, `${baseName}.vtt`);
    const body = [
      'WEBVTT',
      '',
      ...segments.map(
        (segment) => `${formatVttTimestamp(segment.start)} --> ${formatVttTimestamp(segment.end)}\n${normalizeSegmentText(segment)}\n`
      )
    ].join('\n');
    const wrote = await writeFileWithPolicy(vttPath, body, overwritePolicy);
    if (wrote) filesWritten.push(vttPath);
  }

  return filesWritten;
};

export const writeJobJsonOutput = async ({
  outputDirectory,
  baseName,
  source,
  settings,
  outputs,
  transcript,
  status,
  transcripterVersion,
  createdAt = new Date().toISOString(),
  jobId = randomUUID(),
  error
}: JobJsonWriteRequest): Promise<string> => {
  const jobsDirectory = path.join(outputDirectory, 'jobs');
  const jobJsonPath = path.join(jobsDirectory, `${baseName}.job.json`);

  await fs.mkdir(jobsDirectory, { recursive: true });

  const normalizedRawText = normalizeText(transcript.rawText);
  const normalizedSegments = transcript.segments.map((segment) => ({
    ...segment,
    text: normalizeSegmentText(segment)
  }));
  const rawTextHash = createHash('sha256').update(normalizedRawText).digest('hex');

  const payload = {
    schemaVersion: '1.0',
    jobId,
    createdAt,
    transcripterVersion,
    status,
    source: {
      fileName: source.fileName,
      originalPath: source.originalPath,
      durationSeconds: source.durationSeconds ?? null
    },
    settings,
    outputs,
    transcript: {
      rawText: normalizedRawText,
      segments: normalizedSegments
    },
    hash: {
      algo: 'sha256',
      rawText: rawTextHash
    },
    ...(error ? { error } : {})
  };

  await writeFileAtomically(jobJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  return jobJsonPath;
};
