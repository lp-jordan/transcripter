import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import nlp from 'compromise';
import type { AppSettings, PodcastSplitterStatus, Segment, SplitChunk, SplitManifest, SplitRequest, SplitResult, SplitSuccess, SplitVideo, SplitVideoVerificationStatus } from './types';
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
const DEFAULT_OPENAI_TIMEOUT_MS = 60_000;
const DEFAULT_OPENAI_MAX_RETRIES = 2;
const AVERAGE_WORDS_PER_SECOND = 2.6;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

const LONG_TRANSCRIPT_SEGMENT_THRESHOLD = 180;
const WINDOW_TARGET_MIN_SEC = 18 * 60;
const WINDOW_TARGET_MAX_SEC = 28 * 60;
const WINDOW_HARD_MIN_SEC = 12 * 60;
const WINDOW_HARD_MAX_SEC = 35 * 60;

const getCoarseWindowPolicy = (): DurationPolicy => ({
  softMinSec: WINDOW_TARGET_MIN_SEC,
  softMaxSec: WINDOW_TARGET_MAX_SEC,
  hardMinSec: WINDOW_HARD_MIN_SEC,
  hardMaxSec: WINDOW_HARD_MAX_SEC
});

const buildCoarseWindows = (segments: Segment[]): ChunkRange[] => {
  if (segments.length === 0) {
    return [];
  }

  const windowPolicy = getCoarseWindowPolicy();
  return enforceDurationPolicy(deterministicSplit(segments, windowPolicy), segments, windowPolicy);
};
type AiPlanOutcome = {
  ranges: ChunkRange[] | null;
  attempted: boolean;
  warning?: string;
};

type HierarchicalAiPlanOutcome = AiPlanOutcome & {
  usedWindowing: boolean;
};

type ProposedCut = {
  startIndex: number;
  endIndex: number;
  justification?: string;
};

type Stage2ValidationResult = {
  overall_pass: boolean;
  move: 'keep' | 'forward' | 'backward';
  reason: string;
  flags?: string[];
};

type Stage3VideoMetadata = {
  title: string;
  summary: string;
};

type BoundaryRiskSignal = 'question' | 'story' | 'framework' | 'continuation';

type AnthropicTextResponse = {
  attempted: boolean;
  text: string | null;
  warning?: string;
};

const extractJsonSnippet = (value: string): string | null => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1] : value;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }

  const firstBracket = candidate.indexOf('[');
  const lastBracket = candidate.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return candidate.slice(firstBracket, lastBracket + 1);
  }

  return null;
};

const parseJsonValue = <T>(value: string): T | null => {
  const snippet = extractJsonSnippet(value);
  if (!snippet) {
    return null;
  }

  try {
    return JSON.parse(snippet) as T;
  } catch {
    return null;
  }
};

const getAnthropicRequestConfig = (settings: AppSettings, unitCount: number) => {
  const apiKey = settings.anthropicApiKey?.trim() ?? '';
  const model = settings.anthropicModel?.trim() || DEFAULT_ANTHROPIC_MODEL;
  let timeoutMs = clamp(settings.openaiTimeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS, 10_000, 300_000);
  let retries = clamp(settings.openaiMaxRetries ?? DEFAULT_OPENAI_MAX_RETRIES, 0, 6);
  const adaptiveTimeoutMs = clamp(30_000 + unitCount * 250, 30_000, 300_000);
  timeoutMs = Math.max(timeoutMs, adaptiveTimeoutMs);
  if (unitCount > 160) {
    retries = Math.max(retries, 2);
  }

  return { apiKey, model, timeoutMs, retries };
};

const getRetryDelayMs = (attempt: number, response: Response | null): number => {
  if (response?.status === 429) {
    const headerValue = response.headers.get('anthropic-ratelimit-tokens-reset') ?? response.headers.get('retry-after');
    if (headerValue) {
      const seconds = Number(headerValue);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000);
      }

      const dateMs = Date.parse(headerValue);
      if (Number.isFinite(dateMs)) {
        return Math.max(0, dateMs - Date.now());
      }
    }
  }

  return Math.min(4_000, 750 * attempt);
};

const callAnthropicText = async (
  systemPrompt: string,
  userPrompt: string,
  settings: AppSettings,
  fetchImpl: typeof fetch,
  options?: {
    maxTokens?: number;
    model?: string;
    unitCount?: number;
    temperature?: number;
  }
): Promise<AnthropicTextResponse> => {
  const unitCount = options?.unitCount ?? 1;
  const config = getAnthropicRequestConfig(settings, unitCount);
  if (config.apiKey.length === 0) {
    return {
      attempted: false,
      text: null,
      warning: 'Claude API key missing in Settings. Used fallback splitter.'
    };
  }

  let attempt = 0;
  let lastWarning = 'Claude AI request failed. Used fallback splitter.';

  while (attempt <= config.retries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response | null = null;

    try {
      response = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: options?.model ?? config.model,
          max_tokens: options?.maxTokens ?? 2048,
          temperature: options?.temperature ?? 0.2,
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
      const text = payload.content?.find((item) => item.type === 'text')?.text ?? null;
      if (!text) {
        lastWarning = 'Claude returned an empty response. Used fallback splitter.';
        throw new Error(lastWarning);
      }

      return {
        attempted: true,
        text
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastWarning = 'Claude request timed out. Used fallback splitter.';
      }

      if (attempt > config.retries) {
        return {
          attempted: true,
          text: null,
          warning: lastWarning
        };
      }

      await sleep(getRetryDelayMs(attempt, response));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    attempted: true,
    text: null,
    warning: lastWarning
  };
};

const buildAnthropicUnits = (segments: Segment[]) =>
  segments.map((segment, index) => ({
    index,
    startSec: Number(segment.start.toFixed(2)),
    endSec: Number(segment.end.toFixed(2)),
    text: segment.text.slice(0, 220)
  }));

const normalizeProposedCuts = (cuts: ProposedCut[], segments: Segment[]): ProposedCut[] => {
  if (segments.length === 0) {
    return [];
  }

  const maxIndex = cuts.reduce((max, cut) => Math.max(max, cut.endIndex), -Infinity);
  if (!Number.isFinite(maxIndex) || maxIndex <= segments.length - 1) {
    return cuts;
  }

  return cuts.map((cut) => ({
    ...cut,
    startIndex: mapSecondToSegmentIndex(segments, cut.startIndex, 'start'),
    endIndex: mapSecondToSegmentIndex(segments, cut.endIndex, 'end')
  }));
};

const parseStage1Cuts = (value: string, segments: Segment[]): ChunkRange[] | null => {
  const parsed = parseJsonValue<{ proposed_cuts?: ProposedCut[]; chunks?: ProposedCut[] }>(value);
  const cuts = parsed?.proposed_cuts ?? parsed?.chunks;
  if (!Array.isArray(cuts) || cuts.length === 0) {
    return null;
  }

  const normalizedCuts = normalizeProposedCuts(
    cuts.filter((entry) => Number.isFinite(entry.startIndex) && Number.isFinite(entry.endIndex)),
    segments
  );

  if (normalizedCuts.length === 0) {
    return null;
  }

  return normalizeRanges(
    normalizedCuts.map((cut) => ({
      startIndex: cut.startIndex,
      endIndex: cut.endIndex
    })),
    segments.length
  );
};

const requestStage1SplitPlan = async (
  segments: Segment[],
  policy: DurationPolicy,
  settings: AppSettings,
  fetchImpl: typeof fetch
): Promise<AiPlanOutcome> => {
  const units = buildAnthropicUnits(segments);
  const systemPrompt = [
    'You are identifying natural narrative segments in a spoken-word transcript.',
    'Your only job is to propose clean narrative units that will later be validated.',
    'Do not write titles. Do not write summaries. Do not explain every rule.',
    'Prefer segments around 2 to 7 minutes, but prioritize narrative completeness over exact timing.',
    'Look for topic shifts, story endings, lesson pivots, and emotional resets.',
    'Return JSON only with this schema: {"proposed_cuts":[{"startIndex":number,"endIndex":number,"justification":string}]}.',
    'Indices refer to transcript timestamps in seconds and must be contiguous, ordered, and cover the full transcript with no gaps.'
  ].join('\n');

  const userPrompt = JSON.stringify({
    task: 'Propose narrative cut candidates for later validation.',
    policy: {
      preferredMinSec: policy.hardMinSec,
      preferredMaxSec: policy.hardMaxSec,
      softMinSec: policy.softMinSec,
      softMaxSec: policy.softMaxSec
    },
    units
  });

  const response = await callAnthropicText(systemPrompt, userPrompt, settings, fetchImpl, {
    maxTokens: 1800,
    unitCount: units.length
  });

  if (!response.text) {
    return {
      ranges: null,
      attempted: response.attempted,
      ...(response.warning ? { warning: response.warning } : {})
    };
  }

  const ranges = parseStage1Cuts(response.text, segments);
  if (!ranges) {
    return {
      ranges: null,
      attempted: response.attempted,
      warning: 'Claude returned Stage 1 output but not valid proposed cuts. Used fallback splitter.'
    };
  }

  return {
    ranges,
    attempted: response.attempted
  };
};

const isSentenceEnding = (text: string): boolean => /[.!?]["')\]]?\s*$/.test(text.trim());
const startsLikeSentence = (text: string): boolean => /^["'([A-Z0-9]/.test(text.trim());

const getSentenceWindowText = (segments: Segment[], startIndex: number, endIndex: number): string =>
  segments
    .slice(startIndex, endIndex + 1)
    .map((segment) => segment.text)
    .join(' ')
    .trim();

const findSentenceBoundaryWithCompromise = (
  segments: Segment[],
  startIndex: number,
  boundaryIndex: number,
  maxIndex: number
): number | null => {
  if (startIndex > maxIndex) {
    return null;
  }

  for (let candidate = boundaryIndex; candidate <= maxIndex; candidate += 1) {
    const windowText = getSentenceWindowText(segments, startIndex, candidate);
    if (!windowText) {
      continue;
    }

    const sentences = nlp(windowText).sentences().json();
    if (sentences.length === 0) {
      continue;
    }

    const normalizedWindow = normalizeText(windowText);
    const leadingText = normalizeText(getSentenceWindowText(segments, startIndex, Math.max(startIndex, candidate - 1)));
    const sentenceBoundaryMatches = sentences.some((sentence: { text?: string }) => {
      const sentenceText = normalizeText(String((sentence as { text?: string }).text ?? ''));
      if (!sentenceText || !normalizedWindow.endsWith(sentenceText)) {
        return false;
      }

      return leadingText.length === 0 || leadingText.length < normalizedWindow.length - sentenceText.length + 1;
    });

    if (sentenceBoundaryMatches || isSentenceEnding(segments[candidate]?.text ?? '')) {
      return candidate;
    }
  }

  return null;
};

const precheckBoundaryIndex = (segments: Segment[], boundaryIndex: number, minIndex: number, maxIndex: number): number => {
  const boundaryText = segments[boundaryIndex]?.text ?? '';
  const nextText = segments[boundaryIndex + 1]?.text ?? '';
  if (isSentenceEnding(boundaryText) && (nextText.length === 0 || startsLikeSentence(nextText))) {
    return boundaryIndex;
  }

  const searchStart = Math.max(minIndex, boundaryIndex - 2);
  const resolvedBoundary = findSentenceBoundaryWithCompromise(segments, searchStart, boundaryIndex, maxIndex);
  if (resolvedBoundary !== null) {
    return resolvedBoundary;
  }

  for (let index = Math.min(boundaryIndex + 1, maxIndex); index <= maxIndex; index += 1) {
    if (isSentenceEnding(segments[index]?.text ?? '')) {
      return index;
    }
  }

  return boundaryIndex;
};
const detectBoundaryRiskSignals = (segments: Segment[], boundaryIndex: number): BoundaryRiskSignal[] => {
  const start = Math.max(0, boundaryIndex - 2);
  const end = Math.min(segments.length - 1, boundaryIndex + 2);
  const nearbyText = segments.slice(start, end + 1).map((segment) => segment.text).join(' ').toLowerCase();
  const signals = new Set<BoundaryRiskSignal>();

  if (/\?/.test(nearbyText)) {
    signals.add('question');
  }

  if (/let me tell you|story|case study|study|united \d+|flight \d+/i.test(nearbyText)) {
    signals.add('story');
  }

  if (/i call it|we call it|effect|methodology|framework/i.test(nearbyText)) {
    signals.add('framework');
  }

  if (/this is why|which means|and so|therefore|because of that|that is why/i.test(nearbyText)) {
    signals.add('continuation');
  }

  return [...signals];
};

const buildValidationWindow = (segments: Segment[], boundaryIndex: number, windowRadius = 4): string => {
  const start = Math.max(0, boundaryIndex - windowRadius);
  const end = Math.min(segments.length - 1, boundaryIndex + 1 + windowRadius);
  const before = segments.slice(start, boundaryIndex + 1).map((segment) => segment.text).join(' ');
  const after = segments.slice(boundaryIndex + 1, end + 1).map((segment) => segment.text).join(' ');
  return `${before} <<<CUT>>> ${after}`;
};

const parseStage2Validation = (value: string): Stage2ValidationResult | null => {
  const parsed = parseJsonValue<Stage2ValidationResult>(value);
  if (!parsed || typeof parsed.overall_pass !== 'boolean' || typeof parsed.move !== 'string' || typeof parsed.reason !== 'string') {
    return null;
  }

  if (!['keep', 'forward', 'backward'].includes(parsed.move)) {
    return null;
  }

  return parsed;
};

const requestStage2BoundaryValidation = async (
  segments: Segment[],
  boundaryIndex: number,
  settings: AppSettings,
  fetchImpl: typeof fetch
): Promise<{ attempted: boolean; result: Stage2ValidationResult | null; warning?: string }> => {
  const systemPrompt = [
    'You are validating a single transcript boundary.',
    'The cut point is marked with <<<CUT>>>.',
    'Check whether this cut breaks sentence completion, question/answer pairing, story setup/payoff, or framework intro/explanation.',
    'Return JSON only with this schema: {"overall_pass":boolean,"move":"keep"|"forward"|"backward","reason":string,"flags":[string]}.',
    'Use move="forward" if the cut should move later, move="backward" if it should move earlier, and move="keep" if the cut is acceptable.'
  ].join('\n');

  const userPrompt = buildValidationWindow(segments, boundaryIndex);
  const response = await callAnthropicText(systemPrompt, userPrompt, settings, fetchImpl, {
    maxTokens: 400,
    unitCount: 1
  });

  if (!response.text) {
    return {
      attempted: response.attempted,
      result: null,
      ...(response.warning ? { warning: response.warning } : {})
    };
  }

  const result = parseStage2Validation(response.text);
  if (!result) {
    return {
      attempted: response.attempted,
      result: null,
      warning: 'Claude returned Stage 2 output but not valid validation JSON. Kept original boundary.'
    };
  }

  return {
    attempted: response.attempted,
    result
  };
};

const rangesToBoundaries = (ranges: ChunkRange[]): number[] => ranges.slice(0, -1).map((range) => range.endIndex);

const boundariesToRanges = (boundaries: number[], segmentCount: number): ChunkRange[] => {
  if (segmentCount === 0) {
    return [];
  }

  const ranges: ChunkRange[] = [];
  let startIndex = 0;
  for (const boundary of boundaries) {
    ranges.push({ startIndex, endIndex: boundary });
    startIndex = boundary + 1;
  }
  ranges.push({ startIndex, endIndex: segmentCount - 1 });
  return normalizeRanges(ranges, segmentCount);
};

const validateProposedRanges = async (
  ranges: ChunkRange[],
  segments: Segment[],
  settings: AppSettings,
  fetchImpl: typeof fetch,
  emitStatus?: (message: string) => void
): Promise<{ ranges: ChunkRange[]; attempted: boolean; warning?: string }> => {
  if (ranges.length <= 1) {
    return { ranges, attempted: false };
  }

  const boundaries = rangesToBoundaries(ranges);
  let attempted = false;
  const warnings: string[] = [];

  for (let boundaryPosition = 0; boundaryPosition < boundaries.length; boundaryPosition += 1) {
    const previousBoundary = boundaryPosition === 0 ? -1 : boundaries[boundaryPosition - 1];
    const nextBoundary = boundaryPosition === boundaries.length - 1 ? segments.length - 1 : boundaries[boundaryPosition + 1];
    const minIndex = previousBoundary + 1;
    const maxIndex = nextBoundary - 1;
    let boundaryIndex = boundaries[boundaryPosition];

    const prechecked = precheckBoundaryIndex(segments, boundaryIndex, minIndex, maxIndex);
    if (prechecked !== boundaryIndex) {
      emitStatus?.(`Auto-adjusted boundary ${boundaryPosition + 1}/${boundaries.length} to next sentence end.`);
      boundaryIndex = prechecked;
      boundaries[boundaryPosition] = boundaryIndex;
    }

    const riskSignals = detectBoundaryRiskSignals(segments, boundaryIndex);
    if (riskSignals.length === 0) {
      continue;
    }

    emitStatus?.(`Validating boundary ${boundaryPosition + 1}/${boundaries.length} (${riskSignals.join(', ')}).`);
    const validation = await requestStage2BoundaryValidation(segments, boundaryIndex, settings, fetchImpl);
    attempted ||= validation.attempted;
    if (validation.warning) {
      warnings.push(validation.warning);
    }

    const result = validation.result;
    if (!result || result.overall_pass || result.move === 'keep') {
      continue;
    }

    if (result.move === 'forward') {
      boundaries[boundaryPosition] = precheckBoundaryIndex(segments, Math.min(boundaryIndex + 1, maxIndex), minIndex, maxIndex);
      continue;
    }

    if (result.move === 'backward') {
      boundaries[boundaryPosition] = Math.max(minIndex, boundaryIndex - 1);
    }
  }

  return {
    ranges: boundariesToRanges(boundaries, segments.length),
    attempted,
    ...(warnings.length > 0 ? { warning: warnings.join(' | ') } : {})
  };
};

const requestAiSplitPlan = async (
  segments: Segment[],
  policy: DurationPolicy,
  settings: AppSettings,
  fetchImpl: typeof fetch,
  emitStatus?: (message: string) => void
): Promise<HierarchicalAiPlanOutcome> => {
  if ((settings.anthropicApiKey?.trim() ?? '').length === 0 || segments.length <= LONG_TRANSCRIPT_SEGMENT_THRESHOLD) {
    const stage1Outcome = await requestStage1SplitPlan(segments, policy, settings, fetchImpl);
    if (!stage1Outcome.ranges) {
      return { ...stage1Outcome, usedWindowing: false };
    }

    emitStatus?.('Running local sentence pre-check and boundary validation.');
    const validated = await validateProposedRanges(stage1Outcome.ranges, segments, settings, fetchImpl, emitStatus);
    return {
      ranges: validated.ranges,
      attempted: stage1Outcome.attempted || validated.attempted,
      usedWindowing: false,
      ...(stage1Outcome.warning || validated.warning
        ? { warning: [stage1Outcome.warning, validated.warning].filter(Boolean).join(' | ') }
        : {})
    };
  }

  const windows = buildCoarseWindows(segments);
  const stitchedRanges: ChunkRange[] = [];
  const warnings: string[] = [];
  let attempted = false;

  emitStatus?.(`Large transcript detected. Planning ${windows.length} Claude window(s) first.`);

  for (let index = 0; index < windows.length; index += 1) {
    const windowRange = windows[index];
    const windowSegments = segments.slice(windowRange.startIndex, windowRange.endIndex + 1);
    emitStatus?.(`Stage 1 proposal window ${index + 1}/${windows.length} with ${windowSegments.length} segment unit(s).`);

    const outcome = await requestStage1SplitPlan(windowSegments, policy, settings, fetchImpl);
    attempted ||= outcome.attempted;

    if (outcome.ranges && outcome.ranges.length > 0) {
      for (const range of outcome.ranges) {
        stitchedRanges.push({
          startIndex: windowRange.startIndex + range.startIndex,
          endIndex: windowRange.startIndex + range.endIndex,
          title: range.title,
          summary: range.summary
        });
      }
    } else {
      const fallbackRanges = deterministicSplit(windowSegments, policy).map((range) => ({
        startIndex: windowRange.startIndex + range.startIndex,
        endIndex: windowRange.startIndex + range.endIndex,
        title: range.title,
        summary: range.summary
      }));
      stitchedRanges.push(...fallbackRanges);
      const windowStart = formatClockTimestamp(segments[windowRange.startIndex].start);
      const windowEnd = formatClockTimestamp(segments[windowRange.endIndex].end);
      warnings.push(`${outcome.warning ?? 'Claude window planning failed.'} Used deterministic planning for window ${index + 1} (${windowStart} - ${windowEnd}).`);
    }
  }

  const normalized = stitchedRanges.length > 0 ? normalizeRanges(stitchedRanges, segments.length) : null;
  if (!normalized) {
    return {
      ranges: null,
      attempted,
      usedWindowing: true,
      ...(warnings.length > 0 ? { warning: warnings.join(' | ') } : {})
    };
  }

  emitStatus?.('Running local sentence pre-check and boundary validation.');
  const validated = await validateProposedRanges(normalized, segments, settings, fetchImpl, emitStatus);

  return {
    ranges: validated.ranges,
    attempted: attempted || validated.attempted,
    usedWindowing: true,
    ...((warnings.length > 0 || validated.warning)
      ? { warning: [...warnings, validated.warning].filter(Boolean).join(' | ') }
      : {})
  };
};
const cleanGeneratedText = (value: string): string => normalizeText(value);

type AssemblyPolicy = {
  preferredMinSec: number;
  preferredMaxSec: number;
  extendedMaxSec: number;
};

const getRangeDurationSec = (segments: Segment[], range: ChunkRange): number => segments[range.endIndex].end - segments[range.startIndex].start;

const getAssemblyPolicy = (policy: DurationPolicy): AssemblyPolicy => ({
  preferredMinSec: Math.max(policy.softMinSec + 60, 240),
  preferredMaxSec: Math.max(policy.softMaxSec, 360),
  extendedMaxSec: Math.max(policy.hardMaxSec + 120, policy.softMaxSec + 180)
});

const scoreRangeAsVideoEnding = (
  segments: Segment[],
  range: ChunkRange,
  policy: AssemblyPolicy,
  isFinalRange: boolean
): number => {
  const duration = getRangeDurationSec(segments, range);
  const center = (policy.preferredMinSec + policy.preferredMaxSec) / 2;
  const distancePenalty = Math.abs(duration - center) / Math.max(center, 1);
  const boundaryText = segments[range.endIndex]?.text ?? '';
  const cueScore = getBoundaryCueScore(boundaryText);
  const punctuationScore = /[.!?]["']?\s*$/.test(boundaryText) ? 0.5 : 0;
  const finalBonus = isFinalRange ? 0.35 : 0;
  return 3 - distancePenalty + cueScore + punctuationScore + finalBonus;
};

const assembleFinalVideoRanges = (ranges: ChunkRange[], segments: Segment[], policy: DurationPolicy): ChunkRange[] => {
  if (ranges.length <= 1) {
    return ranges;
  }

  const assemblyPolicy = getAssemblyPolicy(policy);
  const merged: ChunkRange[] = [];
  let cursor = 0;

  while (cursor < ranges.length) {
    const startRange = ranges[cursor];
    let endCursor = cursor;

    while (endCursor < ranges.length - 1) {
      const current: ChunkRange = {
        startIndex: startRange.startIndex,
        endIndex: ranges[endCursor].endIndex
      };
      const next: ChunkRange = {
        startIndex: startRange.startIndex,
        endIndex: ranges[endCursor + 1].endIndex
      };
      const currentDuration = getRangeDurationSec(segments, current);
      const nextDuration = getRangeDurationSec(segments, next);
      const nextUnitDuration = getRangeDurationSec(segments, ranges[endCursor + 1]);

      if (currentDuration < assemblyPolicy.preferredMinSec && nextDuration <= assemblyPolicy.extendedMaxSec) {
        endCursor += 1;
        continue;
      }

      if (nextUnitDuration < 75 && nextDuration <= assemblyPolicy.extendedMaxSec) {
        endCursor += 1;
        continue;
      }

      if (currentDuration >= assemblyPolicy.preferredMaxSec) {
        break;
      }

      if (nextDuration > assemblyPolicy.extendedMaxSec) {
        break;
      }

      const currentScore = scoreRangeAsVideoEnding(segments, current, assemblyPolicy, endCursor === ranges.length - 1);
      const nextScore = scoreRangeAsVideoEnding(segments, next, assemblyPolicy, endCursor + 1 === ranges.length - 1);
      if (nextScore >= currentScore - 0.15) {
        endCursor += 1;
        continue;
      }

      break;
    }

    merged.push({
      startIndex: startRange.startIndex,
      endIndex: ranges[endCursor].endIndex
    });
    cursor = endCursor + 1;
  }

  return normalizeRanges(merged, segments.length);
};

const summarizeVideoFromChunks = (chunks: SplitChunk[], text: string): string => {
  const summary = cleanGeneratedText(
    chunks
      .map((chunk) => chunk.summary)
      .filter((value) => value.length > 0)
      .slice(0, 2)
      .join(' ')
  );

  if (summary.length > 0) {
    return summary;
  }

  return cleanGeneratedText(summarizeChunk(text));
};

const titleVideoFromChunks = (chunks: SplitChunk[], text: string, index: number): string => {
  if (chunks.length === 1 && chunks[0].title.trim().length > 0) {
    return cleanGeneratedText(chunks[0].title);
  }

  return cleanGeneratedText(titleChunk(text, index));
};

type Stage3MetadataResponse = {
  attempted: boolean;
  ranges: ChunkRange[];
  warning?: string;
};

const parseStage3Metadata = (value: string): Stage3VideoMetadata | null => {
  const parsed = parseJsonValue<Stage3VideoMetadata>(value);
  if (!parsed || typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
    return null;
  }

  return {
    title: cleanGeneratedText(parsed.title),
    summary: cleanGeneratedText(parsed.summary)
  };
};

const requestStage3VideoMetadata = async (
  transcript: NormalizedTranscript,
  ranges: ChunkRange[],
  settings: AppSettings,
  fetchImpl: typeof fetch,
  emitStatus?: (message: string) => void
): Promise<Stage3MetadataResponse> => {
  const enrichedRanges = [...ranges];
  let attempted = false;
  const warnings: string[] = [];

  for (let index = 0; index < enrichedRanges.length; index += 1) {
    const range = enrichedRanges[index];
    const segmentText = makeChunkText(transcript.segments, range);
    const fallbackTitle = cleanGeneratedText(titleChunk(segmentText, index));
    const fallbackSummary = cleanGeneratedText(summarizeChunk(segmentText));
    emitStatus?.(`Generating final summary for video ${index + 1}/${enrichedRanges.length}.`);

    const systemPrompt = [
      'You are generating a working title and one-sentence summary for a final podcast microvideo.',
      'The title should name the specific narrative beat, not a generic segment label.',
      'The summary should describe the complete arc of this final video in one sentence.',
      'Return JSON only with this schema: {"title":string,"summary":string}.'
    ].join('\n');

    const userPrompt = `VIDEO ${index + 1}\nSTART: ${formatClockTimestamp(transcript.segments[range.startIndex].start)}\nEND: ${formatClockTimestamp(transcript.segments[range.endIndex].end)}\n\n${segmentText}`;
    const response = await callAnthropicText(systemPrompt, userPrompt, settings, fetchImpl, {
      maxTokens: 300,
      unitCount: Math.max(1, Math.ceil(segmentText.split(/\s+/g).filter(Boolean).length / 150))
    });
    attempted ||= response.attempted;

    const metadata = response.text ? parseStage3Metadata(response.text) : null;
    if (!metadata) {
      if (response.warning) {
        warnings.push(response.warning);
      }
      enrichedRanges[index] = {
        ...range,
        title: fallbackTitle,
        summary: fallbackSummary
      };
      continue;
    }

    enrichedRanges[index] = {
      ...range,
      title: metadata.title,
      summary: metadata.summary
    };
  }

  return {
    attempted,
    ranges: enrichedRanges,
    ...(warnings.length > 0 ? { warning: warnings.join(' | ') } : {})
  };
};
const buildPlanningChunks = (transcript: NormalizedTranscript, ranges: ChunkRange[]): SplitChunk[] =>
  ranges.map((range, index) => {
    const startSec = transcript.segments[range.startIndex].start;
    const endSec = transcript.segments[range.endIndex].end;
    const text = makeChunkText(transcript.segments, range);
    const title = cleanGeneratedText(range.title ?? titleChunk(text, index));
    const summary = cleanGeneratedText(range.summary ?? summarizeChunk(text));

    return {
      index: index + 1,
      title,
      summary,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      durationSec: Number((endSec - startSec).toFixed(3)),
      textFile: `internal-unit-${String(index + 1).padStart(2, '0')}.txt`,
      charCount: text.length
    };
  });

const buildFinalVideos = (
  transcript: NormalizedTranscript,
  planningRanges: ChunkRange[],
  planningChunks: SplitChunk[],
  finalRanges: ChunkRange[],
  mode: SplitMode
): SplitVideo[] =>
  finalRanges.map((range, index) => {
    const startSec = transcript.segments[range.startIndex].start;
    const endSec = transcript.segments[range.endIndex].end;
    const text = makeChunkText(transcript.segments, range);
    const sourceChunkIndexes = planningRanges
      .map((planningRange, planningIndex) => ({ planningRange, planningIndex }))
      .filter(({ planningRange }) => planningRange.startIndex >= range.startIndex && planningRange.endIndex <= range.endIndex)
      .map(({ planningIndex }) => planningIndex + 1);
    const sourceChunks = sourceChunkIndexes.map((sourceIndex) => planningChunks[sourceIndex - 1]).filter(Boolean);
    const verificationStatus: SplitVideoVerificationStatus = mode === 'ai' ? 'assembled' : 'fallback';

    return {
      index: index + 1,
      title: cleanGeneratedText(range.title ?? titleVideoFromChunks(sourceChunks, text, index)),
      summary: cleanGeneratedText(range.summary ?? summarizeVideoFromChunks(sourceChunks, text)),
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      durationSec: Number((endSec - startSec).toFixed(3)),
      textFile: `video-${String(index + 1).padStart(2, '0')}.txt`,
      charCount: text.length,
      sourceChunkIndexes,
      verificationStatus,
      ...(sourceChunkIndexes.length > 1 ? { notes: [`Assembled from internal units ${sourceChunkIndexes.join(', ')}.`] } : {})
    };
  });

const buildManifest = (
  transcript: NormalizedTranscript,
  planningRanges: ChunkRange[],
  finalRanges: ChunkRange[],
  mode: SplitMode,
  policy: DurationPolicy,
  aiAttempted: boolean,
  aiWarning?: string
): SplitManifest => {
  const chunks = buildPlanningChunks(transcript, planningRanges);
  const videos = buildFinalVideos(transcript, planningRanges, chunks, finalRanges, mode);

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
    videos,
    chunks
  };
};

const formatManifestDuration = (durationSec: number): string => {
  const totalSeconds = Math.max(0, Math.round(durationSec));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatVideoManifestTimestamp = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const buildHumanReadableVideoManifest = (transcript: NormalizedTranscript, manifest: SplitManifest): string => {
  const label = transcript.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Source Video';
  const totalRuntime = transcript.segments.length > 0 ? transcript.segments[transcript.segments.length - 1].end : 0;
  const lines: string[] = [
    `# ${label} - Video Manifest`,
    `# Total runtime: ${formatManifestDuration(totalRuntime)}`,
    `# Videos: ${manifest.videos.length}`,
    '',
    '---',
    ''
  ];

  manifest.videos.forEach((video, index) => {
    lines.push(`**Video ${video.index}: [${formatVideoManifestTimestamp(video.startSec)} - ${formatVideoManifestTimestamp(video.endSec)}]**`);
    lines.push(`Duration: ${formatManifestDuration(video.durationSec)}`);
    lines.push(`Summary: ${video.summary}`);
    if (index < manifest.videos.length - 1) {
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  });

  return `${lines.join('\n')}\n`;
};

const writeManifestOutput = async (
  outputFolderPath: string,
  transcript: NormalizedTranscript,
  manifest: SplitManifest,
  finalRanges: ChunkRange[]
): Promise<SplitSuccess> => {
  const baseFolder = path.join(outputFolderPath, 'videos', safeFileSlug(transcript.fileName));
  await fs.mkdir(baseFolder, { recursive: true });

  for (const video of manifest.videos) {
    const range = finalRanges[video.index - 1];
    const content = makeChunkText(transcript.segments, range);
    await fs.writeFile(path.join(baseFolder, video.textFile), `${content}\n`, 'utf8');
  }

  const manifestPath = path.join(baseFolder, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const videoManifestPath = path.join(baseFolder, 'video-manifest.txt');
  await fs.writeFile(videoManifestPath, buildHumanReadableVideoManifest(transcript, manifest), 'utf8');

  return {
    sourcePath: transcript.sourcePath,
    outputFolderPath: baseFolder,
    manifestPath,
    videoManifestPath,
    videoCount: manifest.videos.length,
    chunkCount: manifest.videos.length,
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

      emitStatus(`Preparing Claude plan for ${transcript.segments.length} segment unit(s).`, {
        sourcePath: transcript.sourcePath,
        fileName: transcript.fileName
      });

      const aiOutcome = await requestAiSplitPlan(
        transcript.segments,
        policy,
        options.settings,
        fetchImpl,
        (message) =>
          emitStatus(message, {
            sourcePath: transcript.sourcePath,
            fileName: transcript.fileName
          })
      );
      if (aiOutcome.ranges && aiOutcome.ranges.length > 0) {
        mode = 'ai';
        ranges = aiOutcome.ranges;
        emitStatus(
          aiOutcome.usedWindowing
            ? `Claude returned a stitched split plan (${aiOutcome.ranges.length} range(s)).`
            : `Claude returned a split plan (${aiOutcome.ranges.length} range(s)).`,
          {
            sourcePath: transcript.sourcePath,
            fileName: transcript.fileName
          }
        );
      } else {
        emitStatus('No valid Claude plan returned. Using deterministic structure only.', {
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

      const planningRanges = enforceDurationPolicy(normalizeRanges(ranges, transcript.segments.length), transcript.segments, policy);
      emitStatus(`Assembling final videos from ${planningRanges.length} internal unit(s).`, {
        sourcePath: transcript.sourcePath,
        fileName: transcript.fileName
      });
      const finalRanges = assembleFinalVideoRanges(planningRanges, transcript.segments, policy);
      const stage3Outcome = await requestStage3VideoMetadata(transcript, finalRanges, options.settings, fetchImpl, (message) =>
        emitStatus(message, {
          sourcePath: transcript.sourcePath,
          fileName: transcript.fileName
        })
      );
      if (stage3Outcome.warning) {
        warnings.push(`${transcript.fileName}: ${stage3Outcome.warning}`);
      }
      const manifest = buildManifest(
        transcript,
        planningRanges,
        stage3Outcome.ranges,
        mode,
        policy,
        aiOutcome.attempted || stage3Outcome.attempted,
        aiOutcome.warning ?? stage3Outcome.warning
      );

      emitStatus('Writing video files and manifests.', {
        sourcePath: transcript.sourcePath,
        fileName: transcript.fileName
      });
      const success = await writeManifestOutput(outputFolderPath, transcript, manifest, stage3Outcome.ranges);
      successes.push(success);

      emitStatus(`Completed split with ${success.videoCount} video(s) via ${success.generationMode}.`, {
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
  getDurationPolicy,
  buildCoarseWindows,
  requestAiSplitPlan,
  precheckBoundaryIndex,
  detectBoundaryRiskSignals,
  assembleFinalVideoRanges,
  buildHumanReadableVideoManifest
};

export const formatChunkTimeRange = (startSec: number, endSec: number): string => `${formatClockTimestamp(startSec)} - ${formatClockTimestamp(endSec)}`;
























