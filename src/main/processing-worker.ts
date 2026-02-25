import { createInterface } from 'node:readline';
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

const canceledJobs = new Set<string>();
const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const ffmpegPath = process.env.TRANSCRIPTER_FFMPEG_PATH;
const whisperPath = process.env.TRANSCRIPTER_WHISPER_PATH;

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

const parseWhisperProgress = (line: string): number | null => {
  const match = line.match(/(\d+(?:\.\d+)?)%/);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  if (Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
};

const runChildProcess = async (jobId: string, command: string, args: string[], onLine?: (line: string) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    activeProcesses.set(jobId, child);

    const stdout = createInterface({ input: child.stdout });
    const stderr = createInterface({ input: child.stderr });

    stdout.on('line', (line) => onLine?.(line));
    stderr.on('line', (line) => onLine?.(line));

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

const transcribeAudio = async (job: ProcessingJob, wavPath: string, tempDir: string): Promise<{ transcriptText: string; segments: Segment[] }> => {
  const whisperCommand = await resolveWhisperCommand();
  const whisperOutputPath = path.join(tempDir, `${job.id}.json`);

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
    wavPath,
    '--model',
    job.model,
    '--task',
    'transcribe',
    '--output_dir',
    tempDir,
    '--output_format',
    'json',
    '--verbose',
    'True'
  ];

  if (job.language) {
    args.push('--language', job.language);
  }

  let lastProgress = 0;
  await runChildProcess(job.id, whisperCommand, args, (line) => {
    const parsedProgress = parseWhisperProgress(line);
    if (parsedProgress === null || parsedProgress <= lastProgress) {
      return;
    }

    lastProgress = parsedProgress;
    postMessage({
      type: 'progress',
      payload: {
        jobId: job.id,
        stage: 'transcribing',
        progress: parsedProgress,
        message: 'Transcribing audio'
      }
    });

    ensureNotCanceled(job.id);
  });

  ensureNotCanceled(job.id);

  const jsonRaw = await fs.readFile(whisperOutputPath, 'utf8');
  const parsed = JSON.parse(jsonRaw) as { text?: string; segments?: Array<Partial<Segment>> };

  const segments = (parsed.segments ?? []).map(sanitizeSegment).filter((segment): segment is Segment => Boolean(segment));

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
    transcriptText: typeof parsed.text === 'string' ? parsed.text.trim() : segments.map((segment) => segment.text).join(' ').trim(),
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
