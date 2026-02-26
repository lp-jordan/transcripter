import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {
  ProcessingJob,
  Segment,
  WorkerInboundMessage,
  WorkerOutboundMessage
} from './types';
import { clampActiveTranscriptionProgress, parseWhisperTranscriptionProgress } from './whisper-progress';

const canceledJobs = new Set<string>();
const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const ffmpegPath = process.env.TRANSCRIPTER_FFMPEG_PATH;
const whisperPath = process.env.TRANSCRIPTER_WHISPER_PATH;
const whisperModelDirectory = process.env.TRANSCRIPTER_WHISPER_MODEL_DIR;

const postMessage = (message: WorkerOutboundMessage) => {
  if (typeof process.send === 'function') {
    process.send(message);
  }
};

const sanitizeSegment = (segment: Partial<Segment>): Segment | null => {
  if (typeof segment.start !== 'number' || typeof segment.end !== 'number' || typeof segment.text !== 'string') {
    return null;
  }

  return {
    start: segment.start,
    end: segment.end,
    text: segment.text.trim()
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const parseTimestampSeconds = (value: string): number | null => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const numericValue = Number.parseFloat(trimmedValue);
  if (Number.isFinite(numericValue) && /^\d+(?:\.\d+)?s?$/i.test(trimmedValue)) {
    return numericValue;
  }

  const timestampMatch = trimmedValue.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!timestampMatch) {
    return null;
  }

  const [, hoursRaw, minutesRaw, secondsRaw] = timestampMatch;
  const hours = hoursRaw ? Number.parseInt(hoursRaw, 10) : 0;
  const minutes = Number.parseInt(minutesRaw, 10);
  const seconds = Number.parseFloat(secondsRaw);

  if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
};

const toSeconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return parseTimestampSeconds(value);
  }

  return null;
};

const toOffsetSeconds = (value: unknown): number | null => {
  const parsedSeconds = toSeconds(value);
  if (parsedSeconds === null) {
    return null;
  }

  if (typeof value === 'number' && Number.isInteger(value) && parsedSeconds >= 1000) {
    return parsedSeconds / 1000;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim()) && parsedSeconds >= 1000) {
    return parsedSeconds / 1000;
  }

  return parsedSeconds;
};

const parseTranscriptionPayload = (payload: unknown): { transcriptText: string; segments: Segment[] } => {
  const parsed = isRecord(payload) ? payload : {};
  const candidateSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
  const normalizedSegments = candidateSegments
    .map((segment) => (isRecord(segment) ? sanitizeSegment(segment as Partial<Segment>) : null))
    .filter((segment): segment is Segment => Boolean(segment));

  const directText = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (directText || normalizedSegments.length > 0) {
    return {
      transcriptText: directText || normalizedSegments.map((segment) => segment.text).join(' ').trim(),
      segments: normalizedSegments
    };
  }

  const transcriptionEntries = Array.isArray(parsed.transcription) ? parsed.transcription : [];
  const entryTexts: string[] = [];
  const transcriptionSegments: Segment[] = [];

  for (const entry of transcriptionEntries) {
    if (!isRecord(entry)) {
      continue;
    }

    const textValue = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (textValue) {
      entryTexts.push(textValue);
    }

    const timestamp = isRecord(entry.timestamp) ? entry.timestamp : null;
    const offsets = isRecord(entry.offsets) ? entry.offsets : null;

    const start =
      toSeconds(entry.start) ??
      toSeconds(entry.from) ??
      toSeconds(entry.t0) ??
      toSeconds(timestamp?.start) ??
      toSeconds(timestamp?.from) ??
      toOffsetSeconds(offsets?.start) ??
      toOffsetSeconds(offsets?.from);

    const end =
      toSeconds(entry.end) ??
      toSeconds(entry.to) ??
      toSeconds(entry.t1) ??
      toSeconds(timestamp?.end) ??
      toSeconds(timestamp?.to) ??
      toOffsetSeconds(offsets?.end) ??
      toOffsetSeconds(offsets?.to);

    if (textValue && typeof start === 'number' && typeof end === 'number') {
      const segment = sanitizeSegment({ start, end, text: textValue });
      if (segment) {
        transcriptionSegments.push(segment);
      }
    }
  }

  return {
    transcriptText: entryTexts.join(' ').trim(),
    segments: transcriptionSegments
  };
};

const deterministicTempDirectory = (job: ProcessingJob): string => {
  const digest = createHash('sha256').update(`${job.filePath}:${job.id}`).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'transcripter', digest);
};

const ensureNotCanceled = (jobId: string) => {
  if (canceledJobs.has(jobId)) {
    const error = new Error('Job canceled by user');
    (error as Error & { canceled?: boolean }).canceled = true;
    throw error;
  }
};

const forwardStreamLines = (
  stream: NodeJS.ReadableStream,
  onLine?: (line: string) => void
) => {
  let bufferedChunk = '';

  stream.on('data', (chunk: Buffer | string) => {
    bufferedChunk += chunk.toString();
    const parts = bufferedChunk.split(/\r\n|\n|\r/g);
    bufferedChunk = parts.pop() ?? '';

    for (const part of parts) {
      if (part) {
        onLine?.(part);
      }
    }
  });

  stream.on('end', () => {
    if (bufferedChunk) {
      onLine?.(bufferedChunk);
    }
  });
};

const runChildProcess = async (jobId: string, command: string, args: string[], onLine?: (line: string) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    activeProcesses.set(jobId, child);

    forwardStreamLines(child.stdout, onLine);
    forwardStreamLines(child.stderr, onLine);

    child.on('error', (error) => {
      activeProcesses.delete(jobId);
      reject(new Error(`Failed to run command: ${command} ${args.join(' ')} (${error.message})`));
    });

    child.on('close', (code) => {
      activeProcesses.delete(jobId);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit code ${code})`));
    });
  });

const resolveWhisperCommand = async (): Promise<string> => {
  if (!whisperPath || !path.isAbsolute(whisperPath)) {
    throw new Error('Whisper executable path is not configured. Set TRANSCRIPTER_WHISPER_PATH to an absolute path.');
  }

  try {
    await fs.access(whisperPath, fsConstants.R_OK | fsConstants.X_OK);
  } catch {
    throw new Error(`Whisper executable not found. Install/bundle whisper runtime. Expected path: ${whisperPath}`);
  }

  return whisperPath;
};


const getModelFileName = (model: ProcessingJob['model']): string => {
  if (model === 'tiny') {
    return 'ggml-tiny.bin';
  }

  if (model === 'small') {
    return 'ggml-small.bin';
  }

  return 'ggml-base.bin';
};

const resolveWhisperModelPath = async (job: ProcessingJob): Promise<string> => {
  if (!whisperModelDirectory || !path.isAbsolute(whisperModelDirectory)) {
    throw new Error('Whisper model directory is not configured. Set TRANSCRIPTER_WHISPER_MODEL_DIR to an absolute path.');
  }

  const modelPath = path.join(whisperModelDirectory, getModelFileName(job.model));

  try {
    await fs.access(modelPath, fsConstants.R_OK);
  } catch {
    throw new Error(`Whisper model file for "${job.model}" not found. Expected: ${modelPath}`);
  }

  return modelPath;
};

const extractAudio = async (job: ProcessingJob, tempDir: string): Promise<string> => {
  const outputWavPath = path.join(tempDir, `${job.id}.wav`);
  const command = ffmpegPath && path.isAbsolute(ffmpegPath) ? ffmpegPath : 'ffmpeg';

  postMessage({
    type: 'progress',
    payload: {
      jobId: job.id,
      stage: 'extracting_audio',
      progress: 0,
      message: 'Starting FFmpeg audio extraction'
    }
  });

  await runChildProcess(job.id, command, [
    '-y',
    '-i',
    job.filePath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    outputWavPath
  ]);

  ensureNotCanceled(job.id);

  postMessage({
    type: 'progress',
    payload: {
      jobId: job.id,
      stage: 'extracting_audio',
      progress: 100,
      message: 'Audio extraction complete'
    }
  });

  return outputWavPath;
};

const resolveFfprobeCommand = async (): Promise<string> => {
  if (ffmpegPath && path.isAbsolute(ffmpegPath)) {
    const ffprobeCandidate = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    try {
      await fs.access(ffprobeCandidate, fsConstants.R_OK | fsConstants.X_OK);
      return ffprobeCandidate;
    } catch {
      // Fall through to system ffprobe.
    }
  }

  return 'ffprobe';
};

const probeAudioDurationSeconds = async (wavPath: string): Promise<number | null> => {
  const ffprobeCommand = await resolveFfprobeCommand();

  return new Promise((resolve) => {
    const child = spawn(ffprobeCommand, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nokey=1:noprint_wrappers=1',
      wavPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const duration = Number.parseFloat(stdout.trim());
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    });
  });
};

const transcribeAudio = async (job: ProcessingJob, wavPath: string, tempDir: string): Promise<{ transcriptText: string; segments: Segment[] }> => {
  const whisperCommand = await resolveWhisperCommand();
  const whisperModelPath = await resolveWhisperModelPath(job);
  const whisperOutputPrefix = path.join(tempDir, job.id);
  const whisperOutputPath = `${whisperOutputPrefix}.json`;

  postMessage({
    type: 'progress',
    payload: {
      jobId: job.id,
      stage: 'transcribing',
      progress: 0,
      message: `Starting Whisper (${job.model})`
    }
  });

  const args = [
    '-m',
    whisperModelPath,
    '-f',
    wavPath,
    '-oj',
    '-of',
    whisperOutputPrefix
  ];

  if (job.language) {
    args.push('-l', job.language);
  }

  const totalDurationSeconds = await probeAudioDurationSeconds(wavPath);
  let lastProgress = 0;

  await runChildProcess(job.id, whisperCommand, args, (line) => {
    const parsedProgress = parseWhisperTranscriptionProgress(line, totalDurationSeconds ?? 0);
    if (parsedProgress === null) {
      return;
    }

    const nextProgress = clampActiveTranscriptionProgress(parsedProgress);
    if (nextProgress <= lastProgress) {
      return;
    }

    lastProgress = nextProgress;
    postMessage({
      type: 'progress',
      payload: {
        jobId: job.id,
        stage: 'transcribing',
        progress: nextProgress,
        message: 'Transcribing audio'
      }
    });

    ensureNotCanceled(job.id);
  });

  ensureNotCanceled(job.id);

  const jsonRaw = await fs.readFile(whisperOutputPath, 'utf8');
  const { transcriptText, segments } = parseTranscriptionPayload(JSON.parse(jsonRaw));

  postMessage({
    type: 'progress',
    payload: {
      jobId: job.id,
      stage: 'transcribing',
      progress: 100,
      message: 'Transcription complete'
    }
  });

  return {
    transcriptText,
    segments
  };
};

const cleanupTemp = async (tempDir: string) => {
  await fs.rm(tempDir, { recursive: true, force: true });
};

const processJob = async (job: ProcessingJob) => {
  const tempDir = deterministicTempDirectory(job);

  await fs.mkdir(tempDir, { recursive: true });

  try {
    ensureNotCanceled(job.id);

    const wavPath = await extractAudio(job, tempDir);
    const { transcriptText, segments } = await transcribeAudio(job, wavPath, tempDir);

    ensureNotCanceled(job.id);

    postMessage({
      type: 'complete',
      payload: {
        jobId: job.id,
        segments,
        transcriptText
      }
    });
  } catch (error) {
    const castError = error as Error & { canceled?: boolean };
    postMessage({
      type: 'error',
      payload: {
        jobId: job.id,
        error: castError.message,
        canceled: castError.canceled
      }
    });
  } finally {
    await cleanupTemp(tempDir);
    activeProcesses.delete(job.id);
    canceledJobs.delete(job.id);
  }
};

process.on('message', (message: WorkerInboundMessage) => {
  if (message.type === 'cancel') {
    canceledJobs.add(message.jobId);
    const activeProcess = activeProcesses.get(message.jobId);
    if (activeProcess && !activeProcess.killed) {
      activeProcess.kill('SIGTERM');
    }
    return;
  }

  if (message.type === 'run') {
    void processJob(message.job);
  }
});
