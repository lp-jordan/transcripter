import { EventEmitter } from 'node:events';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type {
  ProcessingCompleteEvent,
  ProcessingErrorEvent,
  ProcessingJob,
  ProcessingProgressEvent,
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

  constructor() {
    super();

    const workerPath = path.join(__dirname, 'processing-worker.js');
    this.worker = fork(workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
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
