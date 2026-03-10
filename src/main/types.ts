export type WhisperModel = 'tiny' | 'base' | 'small';

export type OutputOptions = {
  txt: boolean;
  timecodedTxt: boolean;
  srt: boolean;
  vtt: boolean;
  json: boolean;
};

export type OverwritePolicy = 'overwrite' | 'skip-existing';

export type QueueItemStatus =
  | 'pending'
  | 'extracting_audio'
  | 'transcribing'
  | 'writing_outputs'
  | 'done'
  | 'failed'
  | 'canceled';

export type QueueItem = {
  id: string;
  sourcePath: string;
  outputDirectory: string;
  outputOptions: OutputOptions;
  model: WhisperModel;
  language: string;
  status: QueueItemStatus;
  progress: number;
  error?: string;
  outputFiles?: string[];
  batchId?: string;
  batchStartedAt?: string;
  elapsedMs?: number;
};

export type ArchiveBatch = {
  id: string;
  startedAt: string;
  archivedAt: string;
  items: QueueItem[];
};

export type Segment = {
  start: number;
  end: number;
  text: string;
};

export type ProcessingJob = {
  id: string;
  filePath: string;
  outputDirectory: string;
  language?: string;
  model: WhisperModel;
  outputOptions: OutputOptions;
};

export type ProcessingProgressEvent = {
  jobId: string;
  stage: 'extracting_audio' | 'transcribing' | 'writing_outputs';
  progress: number;
  message?: string;
};

export type ProcessingCompleteEvent = {
  jobId: string;
  segments: Segment[];
  transcriptText: string;
};

export type ProcessingErrorEvent = {
  jobId: string;
  error: string;
  canceled?: boolean;
};

export type WorkerInboundMessage =
  | { type: 'run'; job: ProcessingJob }
  | { type: 'cancel'; jobId: string };

export type WorkerOutboundMessage =
  | { type: 'progress'; payload: ProcessingProgressEvent }
  | { type: 'complete'; payload: ProcessingCompleteEvent }
  | { type: 'error'; payload: ProcessingErrorEvent };

export type AppSettings = {
  outputDirectory: string;
  podcastSplitterOutputFolder?: string;
  language: string;
  model: WhisperModel;
  outputOptions: OutputOptions;
  overwritePolicy?: OverwritePolicy;
  writeRunLog?: boolean;
  ingestEnabled?: boolean;
  ingestWatchDirectory?: string;
  aiProvider?: 'openai' | 'anthropic';
  openaiApiKey?: string;
  openaiModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  openaiTimeoutMs?: number;
  openaiMaxRetries?: number;
};

export type LogLevel = 'info' | 'error';

export type AppLogEntry = {
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;
  jobId?: string;
  filePath?: string;
};

export type SplitRequest = {
  sourcePaths: string[];
  outputFolderPath: string;
  targetMinMinutes?: number;
  targetMaxMinutes?: number;
};

export type SplitChunk = {
  index: number;
  title: string;
  summary: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  textFile: string;
  charCount: number;
};

export type SplitManifest = {
  source: {
    fileName: string;
    sourcePath: string;
  };
  generationMode: 'ai' | 'fallback';
  splitMethod: 'ai:anthropic' | 'fallback';
  ai: {
    provider: 'anthropic';
    attempted: boolean;
    warning?: string;
  };
  durationPolicy: {
    softMinSec: number;
    softMaxSec: number;
    hardMinSec: number;
    hardMaxSec: number;
  };
  chunks: SplitChunk[];
};

export type SplitFailure = {
  sourcePath: string;
  error: string;
};

export type SplitSuccess = {
  sourcePath: string;
  outputFolderPath: string;
  manifestPath: string;
  chunkCount: number;
  generationMode: 'ai' | 'fallback';
  splitMethod: 'ai:anthropic' | 'fallback';
  aiAttempted: boolean;
  aiWarning?: string;
};

export type SplitResult = {
  outputFolderPath: string;
  reportPath: string;
  successes: SplitSuccess[];
  failures: SplitFailure[];
  warnings: string[];
};

export type PodcastSplitterStatus = {
  timestamp: string;
  runId: string;
  message: string;
  sourcePath?: string;
  fileName?: string;
  attempt?: number;
  maxAttempts?: number;
};

export type ProjectBundleInput = {
  projectName: string;
  jobsFolderPath?: string;
  jobFilePaths?: string[];
  outputFolderPath: string;
  overwriteConfirmed?: boolean;
};

export type ProjectBundleValidationSummary = {
  includedCount: number;
  excludedCount: number;
  excludedFailedCount: number;
  jsonParseFailureCount: number;
  emptyTranscriptCount: number;
  duplicateFilenameCount: number;
  hasExistingProjectJson: boolean;
  requiresOverwriteConfirmation: boolean;
  warnings: string[];
  includedJobPaths: string[];
  excludedJobPaths: string[];
};

export type ProjectBundleBuildSummary = {
  outputPath: string;
  includedCount: number;
  excludedCount: number;
  excludedFailedCount: number;
  jsonParseFailureCount: number;
  emptyTranscriptCount: number;
  duplicateFilenameCount: number;
  overwritten: boolean;
};

export type ProjectBundleResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
      code:
        | 'INVALID_INPUT'
        | 'NO_JOB_FILES'
        | 'OUTPUT_FOLDER_REQUIRED'
        | 'OVERWRITE_CONFIRMATION_REQUIRED'
        | 'WRITE_FAILED';
      data?: ProjectBundleValidationSummary;
    };






