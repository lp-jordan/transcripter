import fs from 'node:fs/promises';
import path from 'node:path';
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

  await fs.mkdir(outputDirectory, { recursive: true });

  if (outputOptions.txt) {
    const txtPath = path.join(outputDirectory, `${baseName}.txt`);
    const wrote = await writeFileWithPolicy(txtPath, `${normalizedTranscript}\n`, overwritePolicy);
    if (wrote) filesWritten.push(txtPath);
  }

  if (outputOptions.timecodedTxt) {
    const timecodedPath = path.join(outputDirectory, `${baseName}_timecoded.txt`);
    const body = segments
      .map((segment) => `[${formatClockTimestamp(segment.start)}] ${normalizeSegmentText(segment)}`)
      .filter((line) => line.trim().length > 0)
      .join('\n');
    const wrote = await writeFileWithPolicy(timecodedPath, `${body}\n`, overwritePolicy);
    if (wrote) filesWritten.push(timecodedPath);
  }

  if (outputOptions.json) {
    const jsonPath = path.join(outputDirectory, `${baseName}.json`);
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
    const srtPath = path.join(outputDirectory, `${baseName}.srt`);
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
    const vttPath = path.join(outputDirectory, `${baseName}.vtt`);
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
