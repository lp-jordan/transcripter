import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppSettings, PodcastSplitterStatus, Segment, SplitChunk, SplitManifest, SplitRequest, SplitResult, SplitSuccess } from './types';
import { formatClockTimestamp, normalizeText } from './output/formatting';

type NormalizedTranscript = {
  sourcePath: string;
  fileName: string;
  rawText: string;
  segments: Segment[];
};

type DurationPolicy = {
  softMinSec: number;
  softMaxSec: number;
  hardMinSec: number;
  hardMaxSec: number;
};

type ChunkRange = {
  startIndex: number;
  endIndex: number;
  title?: string;
  summary?: string;
};

type SplitMode = 'ai' | 'fallback';

type OpenAiChunkSuggestion = {
  startIndex: number;
  endIndex: number;
  title?: string;
  summary?: string;
};

type OpenAiResult = {
  chunks: OpenAiChunkSuggestion[];
};

type SplitOptions = {
  settings: AppSettings;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  runId?: string;
  onStatus?: (status: PodcastSplitterStatus) => void;
};

type SplitStatusEmitter = (message: string, details?: Omit<PodcastSplitterStatus, 'timestamp' | 'runId' | 'message'>) => void;

const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_TIMEOUT_MS = 20_000;
const DEFAULT_OPENAI_MAX_RETRIES = 1;
const AVERAGE_WORDS_PER_SECOND = 2.6;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const safeFileSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `split-${randomUUID()}`;

const isSegment = (value: unknown): value is Segment => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Segment>;
  return (
    typeof candidate.start === 'number' &&
    Number.isFinite(candidate.start) &&
    typeof candidate.end === 'number' &&
    Number.isFinite(candidate.end) &&
    candidate.end >= candidate.start &&
    typeof candidate.text === 'string'
  );
};

const splitSentences = (input: string): string[] => {
  const compact = normalizeText(input);
  if (compact.length === 0) {
    return [];
  }

  return compact
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])|\n+/g)
    .map((line) => normalizeText(line))
    .filter((line) => line.length > 0);
};

const synthesizeSegmentsFromText = (rawText: string): Segment[] => {
  const sentences = splitSentences(rawText);
  if (sentences.length === 0) {
    return [];
  }

  let cursor = 0;
  const segments: Segment[] = [];
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/g).filter(Boolean).length;
    const duration = Math.max(2, words / AVERAGE_WORDS_PER_SECOND);
    const start = cursor;
    const end = start + duration;
    segments.push({ start, end, text: sentence });
    cursor = end + 0.2;
  }

  return segments;
};

export const parseTranscriptFile = async (sourcePath: string): Promise<NormalizedTranscript> => {
  const resolvedPath = path.resolve(sourcePath);
  const raw = await fs.readFile(resolvedPath, 'utf8');
  const extension = path.extname(resolvedPath).toLowerCase();
  const fileName = path.basename(resolvedPath);

  if (extension === '.txt') {
    const rawText = normalizeText(raw);
    if (rawText.length === 0) {
      throw new Error('Transcript text is empty.');
    }

    return {
      sourcePath: resolvedPath,
      fileName,
      rawText,
      segments: synthesizeSegmentsFromText(rawText)
    };
  }

  if (!resolvedPath.toLowerCase().endsWith('.job.json')) {
    throw new Error('Unsupported file type. Provide .txt or .job.json files.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Invalid JSON file.');
  }

  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  const transcript = record?.transcript && typeof record.transcript === 'object' ? (record.transcript as Record<string, unknown>) : null;
  const rawText = typeof transcript?.rawText === 'string' ? normalizeText(transcript.rawText) : '';
  const segmentsValue = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const segments = segmentsValue.filter(isSegment).map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: normalizeText(segment.text)
  }));

  if (rawText.length === 0 && segments.length === 0) {
    throw new Error('Missing transcript content in .job.json (expected transcript.rawText or transcript.segments).');
  }

  const normalizedRawText = rawText.length > 0 ? rawText : normalizeText(segments.map((segment) => segment.text).join(' '));

  return {
    sourcePath: resolvedPath,
    fileName,
    rawText: normalizedRawText,
    segments: segments.length > 0 ? segments : synthesizeSegmentsFromText(normalizedRawText)
  };
};

const getDurationPolicy = (request: SplitRequest): DurationPolicy => {
  const targetMinMinutes = typeof request.targetMinMinutes === 'number' ? request.targetMinMinutes : 3;
  const targetMaxMinutes = typeof request.targetMaxMinutes === 'number' ? request.targetMaxMinutes : 6;

  const softMinSec = clamp(Math.round(targetMinMinutes * 60), 60, 600);
  const softMaxSec = clamp(Math.round(targetMaxMinutes * 60), softMinSec, 900);

  return {
    softMinSec,
    softMaxSec,
    hardMinSec: 120,
    hardMaxSec: 420
  };
};

const getBoundaryCueScore = (text: string): number => {
  let score = 0;
  if (/[.!?]\s*$/.test(text)) {
    score += 0.8;
  }

  if (/\b(next|moving on|switching gears|in summary|to wrap up|new topic)\b/i.test(text)) {
    score += 1;
  }

  return score;
};

const pickDeterministicEndIndex = (segments: Segment[], startIndex: number, policy: DurationPolicy): number => {
  const chunkStart = segments[startIndex]?.start ?? 0;
  let bestIndex = startIndex;
  let bestScore = -Infinity;
  let firstReachSoftMin = -1;

  for (let endIndex = startIndex; endIndex < segments.length; endIndex += 1) {
    const duration = segments[endIndex].end - chunkStart;
    if (duration >= policy.softMinSec && firstReachSoftMin === -1) {
      firstReachSoftMin = endIndex;
    }

    if (duration > policy.hardMaxSec) {
      break;
    }

    if (duration < policy.softMinSec) {
      continue;
    }

    const center = (policy.softMinSec + policy.softMaxSec) / 2;
    const distancePenalty = Math.abs(duration - center) / center;
    const pauseGap = endIndex + 1 < segments.length ? Math.max(0, segments[endIndex + 1].start - segments[endIndex].end) : 0;
    const pauseScore = Math.min(1.2, pauseGap / 2.5);
    const cueScore = getBoundaryCueScore(segments[endIndex].text);
    const score = 2 - distancePenalty + pauseScore + cueScore;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = endIndex;
    }

    if (duration >= policy.softMaxSec && bestScore > -Infinity) {
      break;
    }
  }

  if (bestScore > -Infinity) {
    return bestIndex;
  }

  if (firstReachSoftMin >= 0) {
    return firstReachSoftMin;
  }

  for (let endIndex = startIndex; endIndex < segments.length; endIndex += 1) {
    const duration = segments[endIndex].end - chunkStart;
    if (duration >= policy.hardMinSec) {
      return endIndex;
    }

    if (duration >= policy.hardMaxSec || endIndex === segments.length - 1) {
      return endIndex;
    }
  }

  return segments.length - 1;
};

const deterministicSplit = (segments: Segment[], policy: DurationPolicy): ChunkRange[] => {
  const ranges: ChunkRange[] = [];
  if (segments.length === 0) {
    return ranges;
  }

  let startIndex = 0;
  while (startIndex < segments.length) {
    const endIndex = pickDeterministicEndIndex(segments, startIndex, policy);
    ranges.push({ startIndex, endIndex });
    startIndex = endIndex + 1;
  }

  return ranges;
};

const normalizeRanges = (ranges: ChunkRange[], segmentCount: number): ChunkRange[] => {
  if (segmentCount === 0) {
    return [];
  }

  const sorted = ranges
    .map((range) => ({
      ...range,
      startIndex: clamp(Math.floor(range.startIndex), 0, segmentCount - 1),
      endIndex: clamp(Math.floor(range.endIndex), 0, segmentCount - 1)
    }))
    .filter((range) => range.endIndex >= range.startIndex)
    .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);

  if (sorted.length === 0) {
    return [{ startIndex: 0, endIndex: segmentCount - 1 }];
  }

  const normalized: ChunkRange[] = [];
  let cursor = 0;

  for (const range of sorted) {
    if (range.endIndex < cursor) {
      continue;
    }

    const startIndex = Math.max(cursor, range.startIndex);
    const endIndex = Math.max(startIndex, range.endIndex);
    normalized.push({ ...range, startIndex, endIndex });
    cursor = endIndex + 1;

    if (cursor >= segmentCount) {
      break;
    }
  }

  if (normalized.length === 0) {
    return [{ startIndex: 0, endIndex: segmentCount - 1 }];
  }

  const last = normalized[normalized.length - 1];
  if (last.endIndex < segmentCount - 1) {
    normalized.push({ startIndex: last.endIndex + 1, endIndex: segmentCount - 1 });
  }

  const first = normalized[0];
  if (first.startIndex > 0) {
    normalized.unshift({ startIndex: 0, endIndex: first.startIndex - 1 });
  }

  return normalized;
};

const enforceDurationPolicy = (ranges: ChunkRange[], segments: Segment[], policy: DurationPolicy): ChunkRange[] => {
  const expanded: ChunkRange[] = [];

  for (const range of ranges) {
    const startSec = segments[range.startIndex].start;
    const endSec = segments[range.endIndex].end;
    const duration = endSec - startSec;

    if (duration <= policy.hardMaxSec) {
      expanded.push(range);
      continue;
    }

    let cursor = range.startIndex;
    while (cursor <= range.endIndex) {
      const partEnd = pickDeterministicEndIndex(segments, cursor, { ...policy, softMinSec: policy.hardMinSec, softMaxSec: policy.hardMaxSec });
      expanded.push({ startIndex: cursor, endIndex: Math.min(partEnd, range.endIndex) });
      cursor = Math.min(partEnd + 1, range.endIndex + 1);
    }
  }

  const merged: ChunkRange[] = [];
  for (const range of expanded) {
    const startSec = segments[range.startIndex].start;
    const endSec = segments[range.endIndex].end;
    const duration = endSec - startSec;

    if (duration >= policy.hardMinSec || merged.length === 0) {
      merged.push(range);
      continue;
    }

    const previous = merged[merged.length - 1];
    const mergedDuration = segments[range.endIndex].end - segments[previous.startIndex].start;
    if (mergedDuration <= policy.hardMaxSec || range.endIndex === segments.length - 1) {
      previous.endIndex = range.endIndex;
    } else {
      merged.push(range);
    }
  }

  return merged;
};

const makeChunkText = (segments: Segment[], range: ChunkRange): string =>
  normalizeText(segments.slice(range.startIndex, range.endIndex + 1).map((segment) => segment.text).join(' '));

const summarizeChunk = (text: string): string => {
  const words = text.split(/\s+/g).filter(Boolean);
  if (words.length <= 24) {
    return text;
  }

  return `${words.slice(0, 24).join(' ')}...`;
};

const titleChunk = (text: string, index: number): string => {
  const words = text
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/g)
    .filter(Boolean)
    .slice(0, 6);

  if (words.length === 0) {
    return `Part ${index + 1}`;
  }

  const head = words.join(' ');
  return head.charAt(0).toUpperCase() + head.slice(1);
};

const mapSecondToSegmentIndex = (segments: Segment[], second: number, mode: 'start' | 'end'): number => {
  if (!Number.isFinite(second)) {
    return mode === 'start' ? 0 : Math.max(0, segments.length - 1);
  }

  if (second <= segments[0].start) {
    return 0;
  }

  const lastIndex = segments.length - 1;
  if (second >= segments[lastIndex].end) {
    return lastIndex;
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (second >= segment.start && second <= segment.end) {
      return index;
    }

    if (second < segment.start) {
      return Math.max(0, index - 1);
    }
  }

  return lastIndex;
};

const normalizeAiChunkIndices = (chunks: OpenAiChunkSuggestion[], segments: Segment[]): OpenAiChunkSuggestion[] => {
  if (segments.length === 0 || chunks.length === 0) {
    return chunks;
  }

  const maxIndex = chunks.reduce((max, chunk) => Math.max(max, chunk.endIndex), -Infinity);
  if (!Number.isFinite(maxIndex) || maxIndex <= segments.length - 1) {
    return chunks;
  }

  return chunks.map((chunk) => ({
    ...chunk,
    startIndex: mapSecondToSegmentIndex(segments, chunk.startIndex, 'start'),
    endIndex: mapSecondToSegmentIndex(segments, chunk.endIndex, 'end')
  }));
};

const parseJsonFromText = (value: string): OpenAiResult | null => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1] : value;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const chunks: OpenAiChunkSuggestion[] = [];
    if (Array.isArray((parsed as { chunks?: unknown }).chunks)) {
      for (const entry of (parsed as { chunks: unknown[] }).chunks) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }

        const record = entry as Record<string, unknown>;
        if (typeof record.startIndex !== 'number' || typeof record.endIndex !== 'number') {
          continue;
        }

        chunks.push({
          startIndex: record.startIndex,
          endIndex: record.endIndex,
          title: typeof record.title === 'string' ? record.title : undefined,
          summary: typeof record.summary === 'string' ? record.summary : undefined
        });
      }
    }

    if (chunks.length === 0) {
      return null;
    }

    return { chunks };
  } catch {
    return null;
  }
};

type AiPlanOutcome = {
  ranges: ChunkRange[] | null;
  attempted: boolean;
  warning?: string;
};

const getAnthropicErrorMessage = (status: number, responseBody: string): string => {
  if (status === 401 || status === 403) {
    return 'Claude API key was rejected (401/403). Check the Anthropic key in Settings.';
  }

  if (status === 429) {
    return 'Claude API rate limit reached (429). Try again shortly.';
  }

  if (status >= 500) {
    return `Claude API temporary server error (${status}).`;
  }

  return `Claude API request failed (${status})${responseBody.length > 0 ? `: ${responseBody.slice(0, 200)}` : '.'}`;
};

const requestAnthropicSplitPlan = async (
  segments: Segment[],
  policy: DurationPolicy,
  settings: AppSettings,
  fetchImpl: typeof fetch
): Promise<AiPlanOutcome> => {
  const apiKey = settings.anthropicApiKey?.trim() ?? '';
  if (apiKey.length === 0) {
    return {
      ranges: null,
      attempted: false,
      warning: 'Claude API key missing in Settings. Used fallback splitter.'
    };
  }

  const model = settings.anthropicModel?.trim() || DEFAULT_ANTHROPIC_MODEL;
  const timeoutMs = clamp(settings.openaiTimeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS, 3_000, 120_000);
  const retries = clamp(settings.openaiMaxRetries ?? DEFAULT_OPENAI_MAX_RETRIES, 0, 4);

  const units = segments.map((segment, index) => ({
    index,
    startSec: Number(segment.start.toFixed(2)),
    endSec: Number(segment.end.toFixed(2)),
    text: segment.text.slice(0, 220)
  }));

  const systemPrompt = [
    'SYSTEM PROMPT',
    'You are splitting a spoken-word transcript into narrative segments targeting approximately 3-6 minutes each.',
    'Hard rules:',
    '- Never cut mid-sentence. If a target boundary lands mid-sentence, move forward to the next sentence-ending punctuation before cutting.',
    '- Never cut mid-anecdote. A story being told must complete before a cut, even if that slightly exceeds target length.',
    '- Each segment must begin at the start of a complete sentence, never completing a sentence left open by the previous segment.',
    '- Before finalizing each cut point, check whether the first sentence of the new segment refers back to or completes the last sentence of the previous segment. If it does, move the cut forward one sentence and check again.',
    '- Do not cut at round time intervals. Cut points must be justified by narrative logic, not timing convenience.',
    'Where to cut (look for natural break signals):',
    '- A declarative statement functioning as a personal thesis or conclusion.',
    '- A cliffhanger or threat that lands cleanly.',
    '- A scene transition - time, location, or cast of characters changes.',
    '- A shift from backstory or setup into real-time action, or vice versa.',
    '- A moment where the emotional register resets.',
    'What to preserve within each segment:',
    '- Setup and payoff must stay together. If a detail is planted, the moment it matters must remain in the same segment.',
    '- Flashbacks or embedded stories must remain entirely within one segment.',
    '- Escalation sequences such as a chase or shooting must not be split mid-action.',
    'Output requirements:',
    '- Return JSON only with this schema: {"chunks":[{"startIndex":number,"endIndex":number,"title":string,"summary":string}]}',
    '- Indices refer to seconds derived from the transcript timestamps. For example [00:04:47] = index 287.',
    '- Indices are inclusive, contiguous, ordered, and must cover the full transcript range with no gaps.',
    '- The title must be a short working title naming the narrative beat, not just a number.',
    '- The summary must describe the specific narrative content of the segment in one sentence - what actually happens, not a vague label. Example: "Curtis describes the 1992 baseball bat attack ordered by Gotti Sr. and checks himself out of the hospital the next morning to go back on air."',
    '- If you cannot write a specific summary without vagueness or run-ons, treat that as a signal the segment lacks a clean narrative unit and revisit the cut points before returning output.'
  ].join('\n');

  const userPrompt = JSON.stringify({
    task: 'Split transcript into coherent topic chunks.',
    policy: {
      softMinSec: policy.softMinSec,
      softMaxSec: policy.softMaxSec,
      hardMinSec: policy.hardMinSec,
      hardMaxSec: policy.hardMaxSec
    },
    units
  });

  let attempt = 0;
  let lastWarning = 'Claude AI request failed. Used fallback splitter.';

  while (attempt <= retries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          temperature: 0.2,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const responseBody = await response.text();
        lastWarning = getAnthropicErrorMessage(response.status, responseBody);
        throw new Error(lastWarning);
      }

      const payload = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const content = payload.content?.find((item) => item.type === 'text')?.text ?? '';
      const parsed = parseJsonFromText(content);
      if (!parsed) {
        lastWarning = 'Claude returned a response but not valid chunk JSON. Used fallback splitter.';
        throw new Error(lastWarning);
      }

      const normalizedChunks = normalizeAiChunkIndices(parsed.chunks, segments);

      return {
        ranges: normalizeRanges(normalizedChunks, segments.length),
        attempted: true
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastWarning = 'Claude request timed out. Used fallback splitter.';
      }

      if (attempt > retries) {
        return {
          ranges: null,
          attempted: true,
          warning: lastWarning
        };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ranges: null,
    attempted: true,
    warning: lastWarning
  };
};

const requestAiSplitPlan = async (
  segments: Segment[],
  policy: DurationPolicy,
  settings: AppSettings,
  fetchImpl: typeof fetch
): Promise<AiPlanOutcome> => requestAnthropicSplitPlan(segments, policy, settings, fetchImpl);

const buildManifest = (
  transcript: NormalizedTranscript,
  ranges: ChunkRange[],
  mode: SplitMode,
  policy: DurationPolicy,
  aiAttempted: boolean,
  aiWarning?: string
): SplitManifest => {
  const chunks: SplitChunk[] = ranges.map((range, index) => {
    const startSec = transcript.segments[range.startIndex].start;
    const endSec = transcript.segments[range.endIndex].end;
    const text = makeChunkText(transcript.segments, range);
    const title = normalizeText(range.title ?? titleChunk(text, index));
    const summary = normalizeText(range.summary ?? summarizeChunk(text));

    return {
      index: index + 1,
      title,
      summary,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      durationSec: Number((endSec - startSec).toFixed(3)),
      textFile: `part-${String(index + 1).padStart(2, '0')}.txt`,
      charCount: text.length
    };
  });

  return {
    source: {
      fileName: transcript.fileName,
      sourcePath: transcript.sourcePath
    },
    generationMode: mode,
    splitMethod: mode === 'ai' ? 'ai:anthropic' : 'fallback',
    ai: {
      provider: 'anthropic',
      attempted: aiAttempted,
      ...(aiWarning ? { warning: aiWarning } : {})
    },
    durationPolicy: policy,
    chunks
  };
};

const writeManifestOutput = async (
  outputFolderPath: string,
  transcript: NormalizedTranscript,
  manifest: SplitManifest,
  ranges: ChunkRange[]
): Promise<SplitSuccess> => {
  const baseFolder = path.join(outputFolderPath, 'chunks', safeFileSlug(transcript.fileName));
  await fs.mkdir(baseFolder, { recursive: true });

  for (const chunk of manifest.chunks) {
    const range = ranges[chunk.index - 1];
    const content = makeChunkText(transcript.segments, range);
    await fs.writeFile(path.join(baseFolder, chunk.textFile), `${content}\n`, 'utf8');
  }

  const manifestPath = path.join(baseFolder, 'manifest.json');
  await fs.writeFile(`${manifestPath}`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    sourcePath: transcript.sourcePath,
    outputFolderPath: baseFolder,
    manifestPath,
    chunkCount: manifest.chunks.length,
    generationMode: manifest.generationMode,
    splitMethod: manifest.splitMethod,
    aiAttempted: manifest.ai.attempted,
    ...(manifest.ai.warning ? { aiWarning: manifest.ai.warning } : {})
  };
};

const ensureValidRequest = (request: SplitRequest) => {
  if (!request || typeof request !== 'object') {
    throw new Error('Invalid split request.');
  }

  if (!Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0) {
    throw new Error('At least one transcript file is required.');
  }

  if (typeof request.outputFolderPath !== 'string' || request.outputFolderPath.trim().length === 0) {
    throw new Error('Output folder is required.');
  }
};

export const splitPodcastTranscripts = async (request: SplitRequest, options: SplitOptions): Promise<SplitResult> => {
  ensureValidRequest(request);
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const outputFolderPath = path.resolve(request.outputFolderPath);
  const policy = getDurationPolicy(request);
  const runId = options.runId ?? randomUUID();
  const emitStatus: SplitStatusEmitter = (message, details) => {
    options.onStatus?.({
      timestamp: now().toISOString(),
      runId,
      message,
      ...(details ?? {})
    });
  };

  const successes: SplitSuccess[] = [];
  const failures: SplitResult['failures'] = [];
  const warnings: string[] = [];

  await fs.mkdir(outputFolderPath, { recursive: true });

  emitStatus(`Starting podcast split run for ${request.sourcePaths.length} file(s).`);

  for (const sourcePath of request.sourcePaths) {
    try {
      emitStatus('Loading transcript file.', { sourcePath, fileName: path.basename(sourcePath) });
      const transcript = await parseTranscriptFile(sourcePath);
      emitStatus(`Transcript ready (${transcript.segments.length} segment(s)).`, {
        sourcePath: transcript.sourcePath,
        fileName: transcript.fileName
      });

      if (transcript.segments.length === 0) {
        throw new Error('Transcript did not contain enough text to split.');
      }

      let mode: SplitMode = 'fallback';
      let ranges = deterministicSplit(transcript.segments, policy);

      emitStatus(`Sending ${transcript.segments.length} segment unit(s) to Claude.`, {
        sourcePath: transcript.sourcePath,
        fileName: transcript.fileName
      });

      const aiOutcome = await requestAiSplitPlan(transcript.segments, policy, options.settings, fetchImpl);
      if (aiOutcome.ranges && aiOutcome.ranges.length > 0) {
        mode = 'ai';
        ranges = aiOutcome.ranges;
        emitStatus(`Claude returned a split plan (${aiOutcome.ranges.length} range(s)).`, {
          sourcePath: transcript.sourcePath,
          fileName: transcript.fileName
        });
      } else {
        emitStatus('No valid Claude plan returned. Using fallback splitter.', {
          sourcePath: transcript.sourcePath,
          fileName: transcript.fileName
        });
      }

      if (aiOutcome.warning) {
        warnings.push(`${transcript.fileName}: ${aiOutcome.warning}`);
        emitStatus(`AI warning: ${aiOutcome.warning}`, {
          sourcePath: transcript.sourcePath,
          fileName: transcript.fileName
        });
      }

      const normalizedRanges = enforceDurationPolicy(normalizeRanges(ranges, transcript.segments.length), transcript.segments, policy);
      const manifest = buildManifest(transcript, normalizedRanges, mode, policy, aiOutcome.attempted, aiOutcome.warning);

      emitStatus('Writing chunk files and manifest.', {
        sourcePath: transcript.sourcePath,
        fileName: transcript.fileName
      });

      const success = await writeManifestOutput(outputFolderPath, transcript, manifest, normalizedRanges);
      successes.push(success);

      emitStatus(`Completed split with ${success.chunkCount} chunk(s) via ${success.generationMode}.`, {
        sourcePath: transcript.sourcePath,
        fileName: transcript.fileName
      });
    } catch (error) {
      const resolvedPath = path.resolve(sourcePath);
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        sourcePath: resolvedPath,
        error: message
      });

      emitStatus(`Failed: ${message}`, {
        sourcePath: resolvedPath,
        fileName: path.basename(resolvedPath)
      });
    }
  }

  emitStatus(`Writing split report (${successes.length} success(es), ${failures.length} failure(s)).`);

  const reportPath = path.join(outputFolderPath, 'split-report.json');
  await fs.writeFile(
    reportPath,
    `${JSON.stringify(
      {
        runId,
        createdAt: now().toISOString(),
        outputFolderPath,
        durationPolicy: policy,
        successes,
        failures,
        warnings,
        totalFiles: request.sourcePaths.length
      },
      null,
      2
    )}
`,
    'utf8'
  );

  emitStatus('Podcast split run complete.');

  return {
    outputFolderPath,
    reportPath,
    successes,
    failures,
    warnings
  };
};

export const __testables = {
  deterministicSplit,
  enforceDurationPolicy,
  normalizeRanges,
  synthesizeSegmentsFromText,
  getDurationPolicy
};

export const formatChunkTimeRange = (startSec: number, endSec: number): string => `${formatClockTimestamp(startSec)} - ${formatClockTimestamp(endSec)}`;










