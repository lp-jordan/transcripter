import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeText } from '../output/formatting';
import type {
  ProjectBundleBuildSummary,
  ProjectBundleInput,
  ProjectBundleResponse,
  ProjectBundleValidationSummary
} from '../types';

const PROJECT_SCHEMA_VERSION = '1.0';

type JsonMap = Record<string, unknown>;

type BundleJobRecord = {
  sourcePath: string;
  fileName: string;
  parsed: JsonMap;
  emptyTranscript: boolean;
};

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

type BundleValidationContext = {
  report: ProjectBundleValidationSummary;
  outputPath: string;
  includedRecords: BundleJobRecord[];
};

type ProjectBundlePayload = {
  schemaVersion: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  source: {
    bundleBuiltByVersion: string;
    inputJobCount: number;
    inputPath?: string;
  };
  settings: {
    defaultModel: string | null;
    defaultLanguage: string | null;
    timestampsAvailable: boolean;
    formatsAvailable: string[];
  };
  videos: Array<{
    id: string;
    fileName: string;
    source: unknown;
    settings: unknown;
    outputs: unknown;
    transcript: unknown;
    hash: unknown;
  }>;
};

const isRecord = (value: unknown): value is JsonMap => typeof value === 'object' && value !== null && !Array.isArray(value);

const discoverFolderCandidates = (jobsFolderPath: string): string[] => {
  const resolved = path.resolve(jobsFolderPath);
  if (path.basename(resolved).toLowerCase() === 'jobs') {
    return [resolved];
  }

  return [path.join(resolved, 'jobs'), resolved];
};

const listJobJsonFilesFromFolder = async (jobsFolderPath: string): Promise<string[]> => {
  for (const folderPath of discoverFolderCandidates(jobsFolderPath)) {
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.job.json'))
        .map((entry) => path.join(folderPath, entry.name));
      if (files.length > 0) {
        return files;
      }
    } catch {
      // Keep searching fallback candidates.
    }
  }

  return [];
};

const collectProjectBundleFilePaths = async (input: ProjectBundleInput): Promise<string[]> => {
  const discoveredPaths = input.jobsFolderPath ? await listJobJsonFilesFromFolder(input.jobsFolderPath) : [];
  const explicitPaths = Array.isArray(input.jobFilePaths) ? input.jobFilePaths : [];

  const allCandidatePaths = [...discoveredPaths, ...explicitPaths]
    .map((candidatePath) => path.resolve(candidatePath))
    .filter((candidatePath) => candidatePath.toLowerCase().endsWith('.job.json'));

  return [...new Set(allCandidatePaths)];
};

const normalizeOutputPaths = (value: unknown, outputFolderPath: string): unknown => {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    if (!path.isAbsolute(value)) {
      return value;
    }

    const relative = path.relative(outputFolderPath, value);
    if (relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return relative.length === 0 ? path.basename(value) : relative;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeOutputPaths(entry, outputFolderPath));
  }

  if (isRecord(value)) {
    const normalized: JsonMap = {};
    for (const [key, nested] of Object.entries(value)) {
      normalized[key] = normalizeOutputPaths(nested, outputFolderPath);
    }

    return normalized;
  }

  return value;
};

const getStringValue = (value: unknown): string | null => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);

const mostCommonValue = (values: Array<string | null>): string | null => {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let winner: string | null = null;
  let winnerCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }

  return winner;
};

const hasTimestamps = (transcript: unknown): boolean => {
  if (!isRecord(transcript)) {
    return false;
  }

  const segments = transcript.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    return false;
  }

  return segments.some((segment) => {
    if (!isRecord(segment)) {
      return false;
    }

    return typeof segment.start === 'number' && Number.isFinite(segment.start) && typeof segment.end === 'number' && Number.isFinite(segment.end);
  });
};

const collectFormats = (outputs: unknown): string[] => {
  if (!isRecord(outputs)) {
    return [];
  }

  return Object.entries(outputs)
    .filter(([, outputPath]) => typeof outputPath === 'string' && outputPath.trim().length > 0)
    .map(([format]) => format)
    .sort((a, b) => a.localeCompare(b));
};

const fileNameSort = (a: BundleJobRecord, b: BundleJobRecord) =>
  a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' }) || a.sourcePath.localeCompare(b.sourcePath);

const toCanonicalJson = (value: unknown): CanonicalJson => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJson(entry));
  }

  if (isRecord(value)) {
    const normalized: { [key: string]: CanonicalJson } = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      normalized[key] = toCanonicalJson(value[key]);
    }

    return normalized;
  }

  return String(value);
};

const stablePrettyJson = (value: unknown): string => `${JSON.stringify(toCanonicalJson(value), null, 2)}\n`;

const writeAtomicFile = async (targetPath: string, content: string): Promise<void> => {
  const directoryPath = path.dirname(targetPath);
  const tempPath = path.join(directoryPath, `.tmp-${path.basename(targetPath)}-${randomUUID()}`);
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, targetPath);
};

const transcriptTextFromVideo = (video: ProjectBundlePayload['videos'][number]): string => {
  if (!isRecord(video.transcript)) {
    return '';
  }

  const rawText = getStringValue(video.transcript.rawText);
  return rawText ? normalizeText(rawText) : '';
};

const buildMergedText = (payload: ProjectBundlePayload): string =>
  `${payload.videos
    .map((video) => transcriptTextFromVideo(video))
    .filter((text) => text.length > 0)
    .join('\n\n')}\n`;

const buildMergedMarkdown = (payload: ProjectBundlePayload): string => {
  const lines: string[] = [`# ${payload.projectName}`, ''];

  for (const video of payload.videos) {
    const transcriptText = transcriptTextFromVideo(video);
    if (transcriptText.length === 0) {
      continue;
    }

    lines.push(`## ${video.fileName}`, '', transcriptText, '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
};

export const validateProjectBundleInput = async (
  input: ProjectBundleInput
): Promise<ProjectBundleResponse<ProjectBundleValidationSummary> & { context?: BundleValidationContext }> => {
  if (typeof input.outputFolderPath !== 'string' || input.outputFolderPath.trim().length === 0) {
    return { ok: false, code: 'OUTPUT_FOLDER_REQUIRED', error: 'An output folder is required.' };
  }

  const allJobPaths = await collectProjectBundleFilePaths(input);
  if (allJobPaths.length === 0) {
    return { ok: false, code: 'NO_JOB_FILES', error: 'No .job.json files were provided or discovered.' };
  }

  const includedRecords: BundleJobRecord[] = [];
  const excludedJobPaths: string[] = [];
  const warnings: string[] = [];

  let excludedFailedCount = 0;
  let jsonParseFailureCount = 0;
  let emptyTranscriptCount = 0;

  for (const jobPath of allJobPaths) {
    try {
      const raw = await fs.readFile(jobPath, 'utf8');
      const parsed = JSON.parse(raw) as JsonMap;

      const status = getStringValue(parsed.status);
      if (status !== 'completed') {
        excludedJobPaths.push(jobPath);
        if (status === 'failed') {
          excludedFailedCount += 1;
        }
        continue;
      }

      const source = isRecord(parsed.source) ? parsed.source : null;
      const transcript = isRecord(parsed.transcript) ? parsed.transcript : null;
      const fileName = getStringValue(source?.fileName);
      if (!fileName || !transcript || typeof transcript.rawText !== 'string') {
        excludedJobPaths.push(jobPath);
        warnings.push(`Excluded ${jobPath}: missing required fields source.fileName or transcript.rawText.`);
        continue;
      }

      const isEmptyTranscript = transcript.rawText.trim().length === 0;
      if (isEmptyTranscript) {
        emptyTranscriptCount += 1;
        warnings.push(`Included ${jobPath}: transcript.rawText is empty.`);
      }

      includedRecords.push({
        sourcePath: jobPath,
        fileName,
        parsed,
        emptyTranscript: isEmptyTranscript
      });
    } catch {
      excludedJobPaths.push(jobPath);
      jsonParseFailureCount += 1;
    }
  }

  includedRecords.sort(fileNameSort);

  const duplicateCounter = new Map<string, number>();
  for (const record of includedRecords) {
    const normalizedName = record.fileName.toLowerCase();
    duplicateCounter.set(normalizedName, (duplicateCounter.get(normalizedName) ?? 0) + 1);
  }

  const duplicateFilenameCount = [...duplicateCounter.values()].filter((count) => count > 1).length;
  if (duplicateFilenameCount > 0) {
    warnings.push(`${duplicateFilenameCount} duplicate filename(s) detected among included jobs.`);
  }

  if (excludedFailedCount > 0) {
    warnings.push(`${excludedFailedCount} failed job(s) were excluded.`);
  }

  if (jsonParseFailureCount > 0) {
    warnings.push(`${jsonParseFailureCount} job file(s) could not be parsed as JSON and were excluded.`);
  }

  const outputFolderPath = path.resolve(input.outputFolderPath);
  const outputPath = path.join(outputFolderPath, 'project.json');

  let hasExistingProjectJson = false;
  try {
    const outputStat = await fs.stat(outputPath);
    hasExistingProjectJson = outputStat.isFile();
  } catch {
    hasExistingProjectJson = false;
  }

  const report: ProjectBundleValidationSummary = {
    includedCount: includedRecords.length,
    excludedCount: excludedJobPaths.length,
    excludedFailedCount,
    jsonParseFailureCount,
    emptyTranscriptCount,
    duplicateFilenameCount,
    hasExistingProjectJson,
    requiresOverwriteConfirmation: hasExistingProjectJson,
    warnings,
    includedJobPaths: includedRecords.map((record) => record.sourcePath),
    excludedJobPaths
  };

  return {
    ok: true,
    data: report,
    context: {
      report,
      outputPath,
      includedRecords
    }
  };
};

export const buildProjectBundle = async (
  input: ProjectBundleInput,
  transcripterVersion: string
): Promise<ProjectBundleResponse<ProjectBundleBuildSummary>> => {
  if (typeof input.projectName !== 'string' || input.projectName.trim().length === 0) {
    return { ok: false, code: 'INVALID_INPUT', error: 'Project name is required.' };
  }

  const validation = await validateProjectBundleInput(input);
  if (!validation.ok) {
    return validation;
  }

  if (!validation.context) {
    return { ok: false, code: 'WRITE_FAILED', error: 'Bundle validation context is unavailable.', data: validation.data };
  }

  if (validation.data.hasExistingProjectJson && !input.overwriteConfirmed) {
    return {
      ok: false,
      code: 'OVERWRITE_CONFIRMATION_REQUIRED',
      error: 'Explicit overwrite confirmation is required before writing project.json.',
      data: validation.data
    };
  }

  const outputFolderPath = path.dirname(validation.context.outputPath);
  const jobsOutputPath = path.join(outputFolderPath, 'jobs');
  const exportsOutputPath = path.join(outputFolderPath, 'exports');

  const includedJobs = validation.context.includedRecords;
  const payload: ProjectBundlePayload = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: randomUUID(),
    projectName: input.projectName.trim(),
    createdAt: new Date().toISOString(),
    source: {
      bundleBuiltByVersion: transcripterVersion,
      inputJobCount: includedJobs.length,
      ...(input.jobsFolderPath ? { inputPath: path.resolve(input.jobsFolderPath) } : {})
    },
    settings: {
      defaultModel: mostCommonValue(includedJobs.map((record) => getStringValue(isRecord(record.parsed.settings) ? record.parsed.settings.model : null))),
      defaultLanguage: mostCommonValue(
        includedJobs.map((record) => getStringValue(isRecord(record.parsed.settings) ? record.parsed.settings.language : null))
      ),
      timestampsAvailable: includedJobs.some((record) => hasTimestamps(record.parsed.transcript)),
      formatsAvailable: [...new Set(includedJobs.flatMap((record) => collectFormats(record.parsed.outputs)))].sort((a, b) => a.localeCompare(b))
    },
    videos: includedJobs.map((record) => ({
      id: getStringValue(record.parsed.jobId) ?? randomUUID(),
      fileName: record.fileName,
      source: record.parsed.source ?? null,
      settings: record.parsed.settings ?? null,
      outputs: normalizeOutputPaths(record.parsed.outputs ?? null, outputFolderPath),
      transcript: record.parsed.transcript ?? null,
      hash: record.parsed.hash ?? null
    }))
  };

  try {
    await fs.mkdir(outputFolderPath, { recursive: true });
    await fs.mkdir(jobsOutputPath, { recursive: true });

    const usedJobFileNames = new Map<string, number>();
    for (const record of includedJobs) {
      const originalName = path.basename(record.sourcePath);
      const duplicateIndex = usedJobFileNames.get(originalName) ?? 0;
      usedJobFileNames.set(originalName, duplicateIndex + 1);
      const outputName = duplicateIndex === 0 ? originalName : `${path.parse(originalName).name}.${duplicateIndex}.job.json`;
      const canonicalJobPath = path.join(jobsOutputPath, outputName);
      await fs.writeFile(canonicalJobPath, stablePrettyJson(record.parsed), 'utf8');
    }

    if (input.includeExports) {
      await fs.mkdir(exportsOutputPath, { recursive: true });
      await fs.writeFile(path.join(exportsOutputPath, 'merged.txt'), buildMergedText(payload), 'utf8');
      await fs.writeFile(path.join(exportsOutputPath, 'merged.md'), buildMergedMarkdown(payload), 'utf8');
    }

    await writeAtomicFile(validation.context.outputPath, stablePrettyJson(payload));

    return {
      ok: true,
      data: {
        outputPath: validation.context.outputPath,
        includedCount: validation.data.includedCount,
        excludedCount: validation.data.excludedCount,
        excludedFailedCount: validation.data.excludedFailedCount,
        jsonParseFailureCount: validation.data.jsonParseFailureCount,
        emptyTranscriptCount: validation.data.emptyTranscriptCount,
        duplicateFilenameCount: validation.data.duplicateFilenameCount,
        overwritten: validation.data.hasExistingProjectJson
      }
    };
  } catch (error) {
    return {
      ok: false,
      code: 'WRITE_FAILED',
      error: error instanceof Error ? error.message : String(error),
      data: validation.data
    };
  }
};
