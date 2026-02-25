import { EventEmitter } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { getWhisperModelFileName } from './whisper-path';
import type {
  ProcessingCompleteEvent,
  ProcessingErrorEvent,
  ProcessingJob,
  ProcessingProgressEvent,
  WhisperModel,
  WorkerInboundMessage,
  WorkerOutboundMessage
} from './types';

type WorkerEvents = {
  progress: [ProcessingProgressEvent];
  complete: [ProcessingCompleteEvent];
  error: [ProcessingErrorEvent];
};

export class ProcessorClient extends EventEmitter<WorkerEvents> {
  private worker: ChildProcess;

  constructor(
    private readonly ffmpegPath: string,
    private readonly whisperPath: string,
    private readonly whisperModelDirectory: string
  ) {
    super();

    const workerPath = path.join(__dirname, 'processing-worker.js');
    this.worker = fork(workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        TRANSCRIPTER_FFMPEG_PATH: ffmpegPath,
        TRANSCRIPTER_WHISPER_PATH: whisperPath,
        TRANSCRIPTER_WHISPER_MODEL_DIR: whisperModelDirectory
      }
    });

    this.worker.on('message', (message: WorkerOutboundMessage) => {
      if (message.type === 'progress') {
        this.emit('progress', message.payload);
      }

      if (message.type === 'complete') {
        this.emit('complete', message.payload);
      }

      if (message.type === 'error') {
        this.emit('error', message.payload);
      }
    });

    this.worker.on('exit', () => {
      this.emit('error', {
        jobId: 'worker',
        error: 'Processing worker exited unexpectedly'
      });
    });
  }

  async validateRuntime(model: WhisperModel): Promise<void> {
    const failures: string[] = [];

    try {
      await fs.access(this.ffmpegPath, fsConstants.R_OK | fsConstants.X_OK);
    } catch {
      failures.push(`FFmpeg executable is missing or not executable at: ${this.ffmpegPath}`);
    }

    try {
      await fs.access(this.whisperPath, fsConstants.R_OK | fsConstants.X_OK);
    } catch {
      failures.push(`whisper.cpp executable is missing or not executable at: ${this.whisperPath}`);
    }

    try {
      await fs.access(this.whisperModelDirectory, fsConstants.R_OK);
    } catch {
      failures.push(`Whisper model directory is missing or unreadable at: ${this.whisperModelDirectory}`);
    }

    const modelPath = path.join(this.whisperModelDirectory, getWhisperModelFileName(model));
    try {
      await fs.access(modelPath, fsConstants.R_OK);
    } catch {
      failures.push(`Whisper model file for "${model}" is missing at: ${modelPath}`);
    }

    if (failures.length > 0) {
      throw new Error(failures.join(' | '));
    }
  }

  run(job: ProcessingJob): void {
    const message: WorkerInboundMessage = { type: 'run', job };
    this.worker.send(message);
  }

  cancel(jobId: string): void {
    const message: WorkerInboundMessage = { type: 'cancel', jobId };
    this.worker.send(message);
  }

  dispose(): void {
    this.worker.kill();
  }
}
