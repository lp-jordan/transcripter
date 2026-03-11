import './style.css';
import type { ArchiveBatch, PodcastSplitterStatus, ProjectBundleInput, ProjectBundleValidationSummary } from '../main/types';
import type { QueueState } from '../preload/preload';
import type { AppLogEntry } from '../main/types';

const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const queueList = document.getElementById('queue-list') as HTMLUListElement;
const queueEmptyMessage = document.getElementById('queue-empty-message') as HTMLParagraphElement;
const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
const outputDirectoryInput = document.getElementById('output-directory') as HTMLInputElement;
const pickOutputDirectoryButton = document.getElementById('pick-output-directory') as HTMLButtonElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;
const languageSelect = document.getElementById('language') as HTMLSelectElement;
const writeRunLogCheckbox = document.getElementById('write-run-log') as HTMLInputElement;
const ingestEnabledCheckbox = document.getElementById('ingest-enabled') as HTMLInputElement;
const ingestWatchFolderPanel = document.getElementById('ingest-watch-folder-panel') as HTMLElement;
const ingestWatchDirectoryInput = document.getElementById('ingest-watch-directory') as HTMLInputElement;
const pickIngestWatchDirectoryButton = document.getElementById('pick-ingest-watch-directory') as HTMLButtonElement;
const txtOutputCheckbox = document.getElementById('format-txt') as HTMLInputElement;
const timecodedTxtOutputCheckbox = document.getElementById('format-timecoded-txt') as HTMLInputElement;
const srtOutputCheckbox = document.getElementById('format-srt') as HTMLInputElement;
const vttOutputCheckbox = document.getElementById('format-vtt') as HTMLInputElement;
const anthropicApiKeyInput = document.getElementById('anthropic-api-key') as HTMLInputElement;
const anthropicModelInput = document.getElementById('anthropic-model') as HTMLInputElement;
const toggleAnthropicApiKeyButton = document.getElementById('toggle-anthropic-api-key') as HTMLButtonElement;
const openaiTimeoutInput = document.getElementById('openai-timeout-ms') as HTMLInputElement;
const openaiMaxRetriesInput = document.getElementById('openai-max-retries') as HTMLInputElement;


const addFilesButton = document.getElementById('add-files') as HTMLButtonElement;
const removeSelectedButton = document.getElementById('remove-selected') as HTMLButtonElement;
const resetSelectedButton = document.getElementById('reset-selected') as HTMLButtonElement;
const changeOutputSelectedButton = document.getElementById('change-output-selected') as HTMLButtonElement;
const archiveCompletedButton = document.getElementById('archive-completed') as HTMLButtonElement;
const clearArchiveButton = document.getElementById('clear-archive') as HTMLButtonElement;
const selectAllQueuedClipsCheckbox = document.getElementById('select-all-queued-clips') as HTMLInputElement;
const selectAllLabel = document.getElementById('select-all-label') as HTMLSpanElement;
const queuePrimaryButton = document.getElementById('queue-primary') as HTMLButtonElement;
const pauseToggleButton = document.getElementById('pause-toggle') as HTMLButtonElement;
const stopCurrentButton = document.getElementById('stop-current') as HTMLButtonElement;
const settingsTriggerButton = document.getElementById('settings-trigger') as HTMLButtonElement;
const settingsMenu = document.getElementById('settings-menu') as HTMLElement;
const settingsBackButton = document.getElementById('settings-back') as HTMLButtonElement;
const toolsTriggerButton = document.getElementById('tools-trigger') as HTMLButtonElement;
const toolsMenu = document.getElementById('tools-menu') as HTMLElement;
const openMergeTranscriptsButton = document.getElementById('open-merge-transcripts') as HTMLButtonElement;
const openBuildProjectBundleButton = document.getElementById('open-build-project-bundle') as HTMLButtonElement;
const openPodcastSplitterButton = document.getElementById('open-podcast-splitter') as HTMLButtonElement;
const mergeTranscriptsModal = document.getElementById('merge-transcripts-modal') as HTMLDialogElement;
const closeMergeTranscriptsButton = document.getElementById('close-merge-transcripts') as HTMLButtonElement;
const mergeDropZone = document.getElementById('merge-drop-zone') as HTMLDivElement;
const mergeFileList = document.getElementById('merge-file-list') as HTMLUListElement;
const compileMergedTranscriptButton = document.getElementById('compile-merged-transcript') as HTMLButtonElement;
const buildProjectBundleModal = document.getElementById('build-project-bundle-modal') as HTMLDialogElement;
const closeBuildProjectBundleButton = document.getElementById('close-build-project-bundle') as HTMLButtonElement;
const bundleProjectNameInput = document.getElementById('bundle-project-name') as HTMLInputElement;
const pickBundleJobsFolderButton = document.getElementById('pick-bundle-jobs-folder') as HTMLButtonElement;
const pickBundleJobFilesButton = document.getElementById('pick-bundle-job-files') as HTMLButtonElement;
const bundleJobsFolderDisplay = document.getElementById('bundle-jobs-folder-display') as HTMLParagraphElement;
const bundleJobDropZone = document.getElementById('bundle-job-drop-zone') as HTMLDivElement;
const bundleJobFileList = document.getElementById('bundle-job-file-list') as HTMLUListElement;
const pickBundleOutputFolderButton = document.getElementById('pick-bundle-output-folder') as HTMLButtonElement;
const bundleOutputFolderDisplay = document.getElementById('bundle-output-folder-display') as HTMLParagraphElement;
const buildProjectBundleButton = document.getElementById('build-project-bundle') as HTMLButtonElement;
const podcastSplitterModal = document.getElementById('podcast-splitter-modal') as HTMLDialogElement;
const closePodcastSplitterButton = document.getElementById('close-podcast-splitter') as HTMLButtonElement;
const pickPodcastSplitterFilesButton = document.getElementById('pick-podcast-splitter-files') as HTMLButtonElement;
const podcastSplitterDropZone = document.getElementById('podcast-splitter-drop-zone') as HTMLDivElement;
const podcastSplitterFileList = document.getElementById('podcast-splitter-file-list') as HTMLUListElement;
const pickPodcastSplitterOutputButton = document.getElementById('pick-podcast-splitter-output') as HTMLButtonElement;
const podcastSplitterOutputDisplay = document.getElementById('podcast-splitter-output-display') as HTMLParagraphElement;
const podcastTargetMinInput = document.getElementById('podcast-target-min') as HTMLInputElement;
const podcastTargetMaxInput = document.getElementById('podcast-target-max') as HTMLInputElement;
const runPodcastSplitterButton = document.getElementById('run-podcast-splitter') as HTMLButtonElement;
const podcastSplitterResults = document.getElementById('podcast-splitter-results') as HTMLUListElement;
const podcastSplitterStatusBar = document.getElementById('podcast-splitter-status-bar') as HTMLDivElement;
const podcastSplitterStatusSpinner = document.getElementById('podcast-splitter-status-spinner') as HTMLSpanElement;
const podcastSplitterStatusText = document.getElementById('podcast-splitter-status-text') as HTMLSpanElement;
const podcastSplitterStatusDetails = document.getElementById('podcast-splitter-status-details') as HTMLDetailsElement;
const podcastSplitterStatusList = document.getElementById('podcast-splitter-status') as HTMLUListElement;
const podcastSplitterWarning = document.getElementById('podcast-splitter-warning') as HTMLParagraphElement;
const podcastSplitterResultsEmpty = document.getElementById('podcast-splitter-results-empty') as HTMLParagraphElement;
const toggleConsoleButton = document.getElementById('toggle-console') as HTMLButtonElement;
const consolePanel = document.getElementById('console-panel') as HTMLElement;
const consoleOutput = document.getElementById('console-output') as HTMLPreElement;
const archiveList = document.getElementById('archive-list') as HTMLUListElement;
const archiveEmptyMessage = document.getElementById('archive-empty-message') as HTMLParagraphElement;
const queueJobCounter = document.getElementById('queue-job-counter') as HTMLElement;
const queueElapsedCounter = document.getElementById('queue-elapsed-counter') as HTMLElement;

const selectedIds = new Set<string>();
let queueState: QueueState = {
  items: [],
  archiveBatches: [],
  activeJobId: null,
  hasRunningJob: false,
  isPaused: false
};

let showConsole = false;
let mergeTranscriptPaths: string[] = [];
let bundleJobFolderPath = '';
let bundleJobFilePaths: string[] = [];
let bundleOutputFolderPath = '';
let podcastSplitterSourcePaths: string[] = [];
let podcastSplitterOutputFolderPath = '';
const podcastSplitterStatusBuffer: string[] = [];
let podcastSplitterStatusPumpTimer: number | null = null;
const appLogs: AppLogEntry[] = [];
const MAX_CONSOLE_LINES = 200;
let activeJobStartedAt = 0;
let activeJobElapsedMs = 0;
let activeJobTimer: number | null = null;
let isAnthropicApiKeyVisible = false;

type QueueProgressRef = {
  statusLabel: HTMLElement;
  progressFill: HTMLSpanElement;
};

const queueProgressRefs = new Map<string, QueueProgressRef>();
const queueDisplayedProgress = new Map<string, number>();
const queueTargetProgress = new Map<string, number>();
const queueStatusCache = new Map<string, QueueState['items'][number]['status']>();
const queueTranscribingStartedAt = new Map<string, number>();
let queueProgressAnimationFrame: number | null = null;

const formatElapsedTime = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const updateQueueFooter = () => {
  const totalJobs = queueState.items.length;
  const activeJobIndex = queueState.activeJobId
    ? queueState.items.findIndex((item) => item.id === queueState.activeJobId)
    : -1;
  const currentJobNumber = activeJobIndex >= 0 ? activeJobIndex + 1 : 0;

  queueJobCounter.textContent = `Job ${currentJobNumber} / ${totalJobs}`;

  const hasActiveJob = queueState.hasRunningJob && queueState.activeJobId !== null;
  const liveElapsed = hasActiveJob && activeJobStartedAt > 0 ? Date.now() - activeJobStartedAt : 0;
  const elapsedMs = activeJobElapsedMs + liveElapsed;
  queueElapsedCounter.textContent = hasActiveJob ? `Elapsed ${formatElapsedTime(elapsedMs)}` : 'Elapsed --:--';
};

const syncActiveJobTimer = () => {
  if (queueState.hasRunningJob && queueState.activeJobId) {
    if (queueState.isPaused) {
      if (activeJobStartedAt > 0) {
        activeJobElapsedMs += Math.max(0, Date.now() - activeJobStartedAt);
        activeJobStartedAt = 0;
      }

      if (activeJobTimer !== null) {
        window.clearInterval(activeJobTimer);
        activeJobTimer = null;
      }

      updateQueueFooter();
      return;
    }

    if (activeJobStartedAt === 0) {
      activeJobStartedAt = Date.now();
    }

    if (activeJobTimer === null) {
      activeJobTimer = window.setInterval(() => {
        updateQueueFooter();
      }, 1000);
    }

    updateQueueFooter();
    return;
  }

  activeJobStartedAt = 0;
  activeJobElapsedMs = 0;
  if (activeJobTimer !== null) {
    window.clearInterval(activeJobTimer);
    activeJobTimer = null;
  }

  updateQueueFooter();
};

let fitWindowTimer: number | null = null;

const requestWindowFitToContent = () => {
  if (fitWindowTimer) {
    clearTimeout(fitWindowTimer);
  }

  fitWindowTimer = window.setTimeout(() => {
    fitWindowTimer = null;
    const contentHeight = document.documentElement.scrollHeight;
    void window.transcripter.window.fitContent(contentHeight);
  }, 80);
};

const formatStatusLabel = (status: string): string =>
  status
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

const fileUrlToPath = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') {
      return null;
    }

    const decodedPathname = decodeURIComponent(parsed.pathname);
    if (/^\/[a-zA-Z]:\//.test(decodedPathname)) {
      return decodedPathname.slice(1);
    }

    return decodedPathname;
  } catch {
    return null;
  }
};

const setToolsMenuOpen = (isOpen: boolean) => {
  toolsMenu.hidden = !isOpen;
  toolsTriggerButton.setAttribute('aria-expanded', String(isOpen));
};

const renderMergeTranscriptList = () => {
  mergeFileList.innerHTML = '';

  mergeTranscriptPaths.forEach((transcriptPath) => {
    const item = document.createElement('li');
    item.textContent = getFileName(transcriptPath);
    mergeFileList.append(item);
  });

  compileMergedTranscriptButton.disabled = mergeTranscriptPaths.length === 0;
};

const appendMergeTranscriptPaths = (paths: string[]) => {
  const txtPaths = paths.filter((candidatePath) => candidatePath.toLowerCase().endsWith('.txt'));
  mergeTranscriptPaths = [...new Set([...mergeTranscriptPaths, ...txtPaths])];
  renderMergeTranscriptList();
};

const isPodcastSplitterFile = (candidatePath: string): boolean => {
  const lower = candidatePath.toLowerCase();
  return lower.endsWith('.txt') || lower.endsWith('.job.json');
};

const appendPodcastSplitterPaths = (paths: string[]) => {
  const filtered = paths.filter((candidatePath) => isPodcastSplitterFile(candidatePath));
  podcastSplitterSourcePaths = [...new Set([...podcastSplitterSourcePaths, ...filtered])];
  renderPodcastSplitterFileList();
};

const renderPodcastSplitterFileList = () => {
  podcastSplitterFileList.innerHTML = '';

  podcastSplitterSourcePaths.forEach((sourcePath) => {
    const item = document.createElement('li');
    item.textContent = getFileName(sourcePath);
    item.title = sourcePath;
    podcastSplitterFileList.append(item);
  });

  runPodcastSplitterButton.disabled =
    podcastSplitterSourcePaths.length === 0 || podcastSplitterOutputFolderPath.trim().length === 0;
};

const renderPodcastSplitterOutput = () => {
  const hasOutputFolder = podcastSplitterOutputFolderPath.trim().length > 0;
  podcastSplitterOutputDisplay.textContent = hasOutputFolder
    ? podcastSplitterOutputFolderPath
    : 'Choose where split transcripts should be written.';
  podcastSplitterOutputDisplay.classList.toggle('actionable-empty', !hasOutputFolder);
  renderPodcastSplitterFileList();
};

const resetPodcastSplitterUi = () => {
  podcastSplitterSourcePaths = [];
  podcastTargetMinInput.value = '3';
  podcastTargetMaxInput.value = '6';
  podcastSplitterResults.innerHTML = '';
  podcastSplitterStatusList.innerHTML = '';
  podcastSplitterStatusBuffer.splice(0, podcastSplitterStatusBuffer.length);
  stopPodcastSplitterStatusPump();
  podcastSplitterStatusDetails.open = false;
  setPodcastSplitterStatusBar('Ready.', false);
  podcastSplitterWarning.hidden = true;
  podcastSplitterWarning.textContent = '';
  podcastSplitterResultsEmpty.hidden = false;
  renderPodcastSplitterOutput();
};

const setPodcastSplitterStatusBar = (message: string, busy = false) => {
  podcastSplitterStatusText.textContent = message;
  podcastSplitterStatusSpinner.hidden = !busy;
  podcastSplitterStatusBar.setAttribute('data-busy', String(busy));
};

const isAiWorkingMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes('claude') && (normalized.includes('sending') || normalized.includes('preparing'));
};

const appendPodcastSplitterStatusLine = (line: string) => {
  const item = document.createElement('li');
  item.textContent = line;
  podcastSplitterStatusList.append(item);
  while (podcastSplitterStatusList.children.length > 14) {
    podcastSplitterStatusList.removeChild(podcastSplitterStatusList.firstElementChild as Node);
  }
};

const formatPodcastSplitterStatus = (status: PodcastSplitterStatus): string => {
  const time = new Date(status.timestamp).toLocaleTimeString();
  const fileLabel = status.fileName ?? (status.sourcePath ? getFileName(status.sourcePath) : 'run');
  const attemptLabel =
    typeof status.attempt === 'number' && typeof status.maxAttempts === 'number'
      ? ` [attempt ${status.attempt}/${status.maxAttempts}]`
      : '';
  return `[${time}] ${fileLabel}${attemptLabel}: ${status.message}`;
};

const startPodcastSplitterStatusPump = () => {
  if (podcastSplitterStatusPumpTimer !== null) {
    window.clearInterval(podcastSplitterStatusPumpTimer);
    podcastSplitterStatusPumpTimer = null;
  }

  podcastSplitterStatusPumpTimer = window.setInterval(() => {
    if (podcastSplitterStatusBuffer.length === 0) {
      return;
    }

    const nextLine = podcastSplitterStatusBuffer.shift();
    if (!nextLine) {
      return;
    }

    appendPodcastSplitterStatusLine(nextLine);
  }, 250);
};

const stopPodcastSplitterStatusPump = () => {
  if (podcastSplitterStatusPumpTimer !== null) {
    window.clearInterval(podcastSplitterStatusPumpTimer);
    podcastSplitterStatusPumpTimer = null;
  }
};

const renderPodcastSplitterResults = (
  result: NonNullable<Awaited<ReturnType<typeof window.transcripter.podcastSplitter.split>>['data']>
) => {
  podcastSplitterResults.innerHTML = '';
  podcastSplitterResultsEmpty.hidden = result.successes.length > 0 || result.failures.length > 0;

  if (result.warnings.length > 0) {
    podcastSplitterWarning.hidden = false;
    podcastSplitterWarning.textContent = `Warnings: ${result.warnings.join(' | ')}`;
  } else {
    podcastSplitterWarning.hidden = true;
    podcastSplitterWarning.textContent = '';
  }

  result.successes.forEach((entry) => {
    const item = document.createElement('li');
    const aiDetail = entry.aiAttempted
      ? entry.generationMode === 'ai'
        ? 'AI used (Claude)'
        : `Fallback used (${entry.aiWarning ?? 'no AI output returned'})`
      : `Fallback used (${entry.aiWarning ?? 'Claude key missing or AI disabled'})`;
    item.textContent = `${getFileName(entry.sourcePath)} -> ${entry.videoCount ?? entry.chunkCount} video(s), ${aiDetail}`;
    item.title = entry.videoManifestPath ?? entry.manifestPath;
    podcastSplitterResults.append(item);
  });

  result.failures.forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = `${getFileName(entry.sourcePath)} -> ERROR: ${entry.error}`;
    podcastSplitterResults.append(item);
  });
};
const appendBundleJobPaths = (paths: string[]) => {
  const filtered = paths.filter((candidatePath) => candidatePath.toLowerCase().endsWith('.job.json'));
  bundleJobFilePaths = [...new Set([...bundleJobFilePaths, ...filtered])];
};
const appendBundleJobPathsFromFolder = async (folderPath: string) => {
  const paths = await window.transcripter.projectBundle.listJobJsonFilesInFolder(folderPath);
  appendBundleJobPaths(paths);
};

const renderBundleFileList = () => {
  bundleJobFileList.innerHTML = '';

  bundleJobFilePaths.forEach((jobPath) => {
    const item = document.createElement('li');
    item.textContent = getFileName(jobPath);
    item.title = jobPath;
    bundleJobFileList.append(item);
  });
};

const getProjectBundleInput = (): ProjectBundleInput => ({
  projectName: bundleProjectNameInput.value.trim(),
  jobsFolderPath: bundleJobFolderPath,
  jobFilePaths: [...bundleJobFilePaths],
  outputFolderPath: bundleOutputFolderPath,
  overwriteConfirmed: true
});

const updateBuildBundleButtonState = () => {
  buildProjectBundleButton.disabled =
    bundleProjectNameInput.value.trim().length === 0 ||
    bundleOutputFolderPath.length === 0 ||
    (bundleJobFolderPath.length === 0 && bundleJobFilePaths.length === 0);
};

const refreshBundleOverwriteState = async () => {
  const input = getProjectBundleInput();
  const validation = await window.transcripter.projectBundle.validate(input);

  if (!validation.ok) {
    updateBuildBundleButtonState();
    return;
  }

  updateBuildBundleButtonState();
};

const renderBundleUi = async () => {
  const hasJobsFolder = bundleJobFolderPath.length > 0;
  const hasOutputFolder = bundleOutputFolderPath.length > 0;
  bundleJobsFolderDisplay.textContent = hasJobsFolder
    ? bundleJobFolderPath
    : 'Choose a jobs folder or add individual .job.json files.';
  bundleOutputFolderDisplay.textContent = hasOutputFolder
    ? bundleOutputFolderPath
    : 'Choose where the finished project bundle should be created.';
  bundleJobsFolderDisplay.classList.toggle('actionable-empty', !hasJobsFolder);
  bundleOutputFolderDisplay.classList.toggle('actionable-empty', !hasOutputFolder);
  renderBundleFileList();
  await refreshBundleOverwriteState();
};

const resetBundleUi = async () => {
  bundleProjectNameInput.value = '';
  bundleJobFolderPath = '';
  bundleJobFilePaths = [];
  bundleOutputFolderPath = '';
  await renderBundleUi();
};

const updateButtons = () => {
  const hasPendingItems = queueState.items.some((item) => item.status === 'pending');
  const canProcessQueue = queueState.hasRunningJob || hasPendingItems;
  const selectableQueueItems = queueState.items.filter((item) => item.id !== queueState.activeJobId);
  const selectedQueueItems = selectableQueueItems.filter((item) => selectedIds.has(item.id));
  const selectedIncompleteQueueItems = selectedQueueItems.filter((item) => item.status !== 'done');
  const allSelectableQueueItemsAreSelected = selectableQueueItems.length > 0 && selectedQueueItems.length === selectableQueueItems.length;

  removeSelectedButton.disabled = selectedQueueItems.length === 0 || queueState.hasRunningJob;
  resetSelectedButton.disabled = selectedQueueItems.length === 0 || queueState.hasRunningJob;
  changeOutputSelectedButton.disabled = selectedIncompleteQueueItems.length === 0 || queueState.hasRunningJob;
  archiveCompletedButton.disabled = queueState.items.every((item) => !['done', 'failed', 'canceled'].includes(item.status));
  clearArchiveButton.disabled = queueState.archiveBatches.length === 0;
  stopCurrentButton.disabled = !queueState.hasRunningJob;
  pauseToggleButton.disabled = !queueState.hasRunningJob;
  pauseToggleButton.textContent = queueState.isPaused ? '>' : '||';
  pauseToggleButton.setAttribute('aria-label', queueState.isPaused ? 'Resume queue' : 'Pause queue');

  selectAllQueuedClipsCheckbox.disabled = selectableQueueItems.length === 0;
  selectAllQueuedClipsCheckbox.checked = allSelectableQueueItemsAreSelected;
  selectAllQueuedClipsCheckbox.indeterminate =
    selectedQueueItems.length > 0 && !allSelectableQueueItemsAreSelected;
  selectAllLabel.textContent = allSelectableQueueItemsAreSelected ? 'Deselect All' : 'Select All';

  queuePrimaryButton.disabled = !canProcessQueue || queueState.hasRunningJob;
  queuePrimaryButton.textContent = 'Start';
};

const syncAnthropicApiKeyVisibility = () => {
  anthropicApiKeyInput.type = isAnthropicApiKeyVisible ? 'text' : 'password';
  toggleAnthropicApiKeyButton.textContent = isAnthropicApiKeyVisible ? 'Hide' : 'Show';
  toggleAnthropicApiKeyButton.setAttribute('aria-pressed', String(isAnthropicApiKeyVisible));
};

const setSettingsMenuOpen = (isOpen: boolean) => {
  settingsMenu.hidden = !isOpen;
  settingsTriggerButton.setAttribute('aria-expanded', String(isOpen));
  requestWindowFitToContent();
};

const formatLogEntry = (entry: AppLogEntry): string => {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const level = entry.level.toUpperCase().padEnd(5, ' ');
  const metaParts = [entry.event];
  if (entry.jobId) {
    metaParts.push(`job=${entry.jobId}`);
  }
  if (entry.filePath) {
    const file = entry.filePath.split(/[/\\]/).pop() ?? entry.filePath;
    metaParts.push(`file=${file}`);
  }
  return `[${time}] ${level} ${metaParts.join(' | ')} :: ${entry.message}`;
};

const renderConsole = () => {
  consolePanel.hidden = !showConsole;
  toggleConsoleButton.setAttribute('aria-expanded', String(showConsole));
  toggleConsoleButton.title = showConsole ? 'Hide process console' : 'Show process console';

  if (!showConsole) {
    return;
  }

  consoleOutput.textContent = appLogs.map(formatLogEntry).join('\n');
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
  requestWindowFitToContent();
};

const pushLog = (entry: AppLogEntry) => {
  appLogs.push(entry);
  if (appLogs.length > MAX_CONSOLE_LINES) {
    appLogs.splice(0, appLogs.length - MAX_CONSOLE_LINES);
  }
  renderConsole();
};

const getFileName = (sourcePath: string) => sourcePath.split(/[/\\]/).pop() ?? sourcePath;

const getMergedTranscriptSourceLabel = (transcriptPath: string): string => {
  const fileName = getFileName(transcriptPath);
  return fileName.replace(/\.txt$/i, '');
};

const getStatusClassName = (status: QueueState['items'][number]['status']): string => {
  if (status === 'pending') {
    return 'status-pending';
  }

  if (status === 'canceled') {
    return 'status-canceled';
  }

  if (status === 'done') {
    return 'status-done';
  }

  if (status === 'failed') {
    return 'status-failed';
  }

  return 'status-processing';
};

const clampQueueProgress = (value: number): number => Math.max(0, Math.min(100, value));

const syncQueueProgressState = () => {
  const activeIds = new Set(queueState.items.map((item) => item.id));

  queueDisplayedProgress.forEach((_, id) => {
    if (!activeIds.has(id)) {
      queueDisplayedProgress.delete(id);
      queueTargetProgress.delete(id);
      queueStatusCache.delete(id);
      queueTranscribingStartedAt.delete(id);
      queueProgressRefs.delete(id);
    }
  });

  queueState.items.forEach((item) => {
    const previousStatus = queueStatusCache.get(item.id);
    if (previousStatus !== item.status) {
      if (item.status === 'transcribing') {
        queueTranscribingStartedAt.set(item.id, Date.now());
      } else {
        queueTranscribingStartedAt.delete(item.id);
      }
    }

    queueStatusCache.set(item.id, item.status);
    queueTargetProgress.set(item.id, clampQueueProgress(item.progress));

    if (!queueDisplayedProgress.has(item.id) || item.status === 'pending') {
      queueDisplayedProgress.set(item.id, clampQueueProgress(item.progress));
    }
  });
};

const getVisualQueueProgressTarget = (item: QueueState['items'][number], now = Date.now()): number => {
  const actualProgress = queueTargetProgress.get(item.id) ?? clampQueueProgress(item.progress);

  if (item.status === 'transcribing') {
    const startedAt = queueTranscribingStartedAt.get(item.id) ?? now;
    const elapsedMs = Math.max(0, now - startedAt);
    const virtualProgress = 6 + 88 * (1 - Math.exp(-elapsedMs / 90000));
    return clampQueueProgress(Math.max(actualProgress, Math.min(94, virtualProgress)));
  }

  if (item.status === 'writing_outputs') {
    return clampQueueProgress(Math.max(actualProgress, 96));
  }

  return actualProgress;
};

const updateQueueProgressVisual = (item: QueueState['items'][number]) => {
  const ref = queueProgressRefs.get(item.id);
  if (!ref) {
    return;
  }

  const displayedProgress = queueDisplayedProgress.get(item.id) ?? clampQueueProgress(item.progress);
  ref.progressFill.style.width = `${displayedProgress}%`;
  ref.statusLabel.textContent = `${formatStatusLabel(item.status)} � ${Math.round(displayedProgress)}%`;
};

const animateQueueProgress = () => {
  const now = Date.now();
  let shouldContinue = false;

  queueState.items.forEach((item) => {
    const desiredProgress = getVisualQueueProgressTarget(item, now);
    const currentProgress = queueDisplayedProgress.get(item.id) ?? desiredProgress;
    const delta = desiredProgress - currentProgress;

    let nextProgress = currentProgress;
    if (Math.abs(delta) > 0.1) {
      const step = Math.sign(delta) * Math.max(0.35, Math.abs(delta) * 0.12);
      nextProgress = Math.abs(delta) <= Math.abs(step) ? desiredProgress : currentProgress + step;
      shouldContinue = true;
    }

    if (item.status === 'transcribing' && desiredProgress < 94) {
      shouldContinue = true;
    }

    queueDisplayedProgress.set(item.id, clampQueueProgress(nextProgress));
    updateQueueProgressVisual(item);
  });

  if (shouldContinue) {
    queueProgressAnimationFrame = window.requestAnimationFrame(animateQueueProgress);
    return;
  }

  queueProgressAnimationFrame = null;
};

const ensureQueueProgressAnimation = () => {
  if (queueProgressAnimationFrame !== null) {
    return;
  }

  queueProgressAnimationFrame = window.requestAnimationFrame(animateQueueProgress);
};

const createQueueItem = (item: QueueState['items'][number]): HTMLLIElement => {
  const li = document.createElement('li');
  li.className = `queue-item ${getStatusClassName(item.status)}`;

  const details = document.createElement('div');
  details.className = 'queue-item-details';

  const header = document.createElement('div');
  header.className = 'queue-item-header';

  const main = document.createElement('div');
  main.className = 'queue-item-main';

  const title = document.createElement('label');
  title.className = 'queue-item-title';

  const selector = document.createElement('input');
  selector.type = 'checkbox';
  selector.checked = selectedIds.has(item.id);
  selector.disabled = item.id === queueState.activeJobId;
  selector.addEventListener('change', () => {
    if (selector.checked) {
      selectedIds.add(item.id);
    } else {
      selectedIds.delete(item.id);
    }
    updateButtons();
  });

  const source = document.createElement('span');
  source.className = 'queue-item-source';
  source.textContent = getFileName(item.sourcePath);
  source.title = item.sourcePath;

  title.append(selector, source);
  main.append(title);

  const status = document.createElement('strong');
  status.className = 'queue-item-status';
  status.textContent = `${formatStatusLabel(item.status)} • ${Math.round(item.progress)}%`;

  header.append(main, status);

  const config = document.createElement('small');
  config.className = 'queue-item-meta';
  const formats = Object.entries(item.outputOptions)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ');
  config.textContent = `Output: ${item.outputDirectory} | Model: ${item.model} | Language: ${item.language} | Formats: ${formats}`;

  details.append(header, config);

  if (item.error) {
    const error = document.createElement('small');
    error.className = 'error';
    error.textContent = item.error;
    details.append(error);
  }

  const actions = document.createElement('div');
  actions.className = 'queue-item-actions';

  if (item.status === 'done') {
    const openOutput = document.createElement('button');
    openOutput.type = 'button';
    openOutput.textContent = 'Open Output Folder';
    openOutput.addEventListener('click', () => {
      void window.transcripter.queue.openOutputFolder(item.id);
    });
    actions.append(openOutput);
  }

  const progressTrack = document.createElement('div');
  progressTrack.className = 'queue-item-progress';
  const progressFill = document.createElement('span');
  progressFill.className = 'queue-item-progress-fill';
  progressFill.style.width = `${Math.max(0, Math.min(100, item.progress))}%`;
  progressTrack.append(progressFill);

  li.append(details, actions, progressTrack);
  return li;
};



const formatElapsedWithLabel = (elapsedMs: number): string => `Elapsed ${formatElapsedTime(elapsedMs)}`;

const formatBatchTime = (iso: string) => {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  };
};

const statusIconByItemStatus: Record<ArchiveBatch['items'][number]['status'], string> = {
  pending: '⏳',
  extracting_audio: '🎧',
  transcribing: '📝',
  writing_outputs: '💾',
  done: '✅',
  failed: '❌',
  canceled: '⏹'
};

const createArchiveBatchItem = (batch: ArchiveBatch): HTMLLIElement => {
  const li = document.createElement('li');
  li.className = 'archive-batch';

  const details = document.createElement('details');
  const summary = document.createElement('summary');

  const startedAt = formatBatchTime(batch.startedAt);
  const batchElapsedMs = batch.items.reduce((total, item) => total + (item.elapsedMs ?? 0), 0);
  summary.textContent = `${startedAt.time} — ${batch.items.length} file${batch.items.length === 1 ? '' : 's'} • ${formatElapsedWithLabel(batchElapsedMs)}`;

  const files = document.createElement('ul');
  files.className = 'archive-file-list';

  for (const item of batch.items) {
    const fileRow = document.createElement('li');
    fileRow.className = 'archive-file-item';

    const status = document.createElement('span');
    status.className = 'archive-status-icon';
    status.textContent = statusIconByItemStatus[item.status];
    status.title = formatStatusLabel(item.status);

    const name = document.createElement('span');
    name.className = 'archive-file-name';
    name.textContent = getFileName(item.sourcePath);
    name.title = item.sourcePath;

    const elapsed = document.createElement('span');
    elapsed.className = 'archive-file-elapsed';
    elapsed.textContent = formatElapsedWithLabel(item.elapsedMs ?? 0);

    const openOutput = document.createElement('button');
    openOutput.type = 'button';
    openOutput.className = 'button-secondary archive-open-output';
    openOutput.textContent = 'Open Output Folder';
    openOutput.disabled = item.status !== 'done';
    openOutput.addEventListener('click', () => {
      void window.transcripter.queue.openOutputFolder(item.id);
    });

    fileRow.append(status, name, elapsed, openOutput);
    files.append(fileRow);
  }

  details.append(summary, files);
  li.append(details);
  li.setAttribute('data-day', startedAt.day);
  return li;
};

const renderArchive = () => {
  archiveList.innerHTML = '';

  const groupedByDay = new Map<string, ArchiveBatch[]>();
  for (const batch of queueState.archiveBatches) {
    const { day } = formatBatchTime(batch.startedAt);
    const existing = groupedByDay.get(day);
    if (existing) {
      existing.push(batch);
    } else {
      groupedByDay.set(day, [batch]);
    }
  }

  for (const [day, batches] of groupedByDay.entries()) {
    const dayGroup = document.createElement('li');
    dayGroup.className = 'archive-day-group';

    const title = document.createElement('p');
    title.className = 'archive-day-title';
    title.textContent = day;

    const batchList = document.createElement('ul');
    batchList.className = 'archive-day-list';
    batches.forEach((batch) => {
      batchList.append(createArchiveBatchItem(batch));
    });

    dayGroup.append(title, batchList);
    archiveList.append(dayGroup);
  }

  archiveEmptyMessage.hidden = true;
};

const renderQueue = () => {
  queueList.innerHTML = '';
  for (const item of queueState.items) {
    queueList.append(createQueueItem(item));
  }

  queueEmptyMessage.hidden = queueState.items.length > 0;
  updateButtons();
  updateQueueFooter();
  renderArchive();
  requestWindowFitToContent();
};

const refreshQueueState = async () => {
  queueState = await window.transcripter.queue.list();
  selectedIds.forEach((id) => {
    if (!queueState.items.some((item) => item.id === id) || id === queueState.activeJobId) {
      selectedIds.delete(id);
    }
  });
  renderQueue();
};

const addFiles = async (paths: string[]) => {
  if (paths.length === 0) {
    return;
  }

  await window.transcripter.queue.add(paths);
};

const openQueueFilePicker = async () => {
  const selectedPaths = await window.transcripter.queue.pickFiles();
  await addFiles(selectedPaths);
};


const setIngestWatchFolderPanelOpen = (isOpen: boolean) => {
  ingestWatchFolderPanel.classList.toggle('is-open', isOpen);
  ingestWatchFolderPanel.setAttribute('aria-hidden', String(!isOpen));
  pickIngestWatchDirectoryButton.disabled = !isOpen;
  requestWindowFitToContent();
};

const applySettingsToUi = (settings: Awaited<ReturnType<typeof window.transcripter.settings.get>>) => {
  outputDirectoryInput.value = settings.outputDirectory;
  modelSelect.value = settings.model;
  languageSelect.value = settings.language;
  if (languageSelect.value !== settings.language) {
    languageSelect.value = 'en';
  }
  writeRunLogCheckbox.checked = Boolean(settings.writeRunLog);
  ingestEnabledCheckbox.checked = Boolean(settings.ingestEnabled);
  ingestWatchDirectoryInput.value = settings.ingestWatchDirectory ?? '';
  setIngestWatchFolderPanelOpen(Boolean(settings.ingestEnabled));
  txtOutputCheckbox.checked = settings.outputOptions.txt;
  timecodedTxtOutputCheckbox.checked = settings.outputOptions.timecodedTxt;
  srtOutputCheckbox.checked = settings.outputOptions.srt;
  vttOutputCheckbox.checked = settings.outputOptions.vtt;
  anthropicApiKeyInput.value = settings.anthropicApiKey ?? '';
  anthropicModelInput.value = settings.anthropicModel ?? 'claude-haiku-4-5-20251001';
  podcastSplitterOutputFolderPath = settings.podcastSplitterOutputFolder?.trim() ?? '';
  renderPodcastSplitterOutput();
  openaiTimeoutInput.value = String(settings.openaiTimeoutMs ?? 60000);
  openaiMaxRetriesInput.value = String(settings.openaiMaxRetries ?? 2);
};

const saveSettings = async () => {
  const saved = await window.transcripter.settings.set({
    outputDirectory: outputDirectoryInput.value,
    language: languageSelect.value,
    model: modelSelect.value as 'tiny' | 'base' | 'small',
    writeRunLog: writeRunLogCheckbox.checked,
    ingestEnabled: ingestEnabledCheckbox.checked,
    ingestWatchDirectory: ingestWatchDirectoryInput.value,
    aiProvider: 'anthropic',
    anthropicApiKey: anthropicApiKeyInput.value,
    anthropicModel: anthropicModelInput.value,
    openaiTimeoutMs: Number.parseInt(openaiTimeoutInput.value, 10),
    openaiMaxRetries: Number.parseInt(openaiMaxRetriesInput.value, 10),
    outputOptions: {
      txt: txtOutputCheckbox.checked,
      timecodedTxt: timecodedTxtOutputCheckbox.checked,
      srt: srtOutputCheckbox.checked,
      vtt: vttOutputCheckbox.checked,
      json: false
    }
  });

  applySettingsToUi(saved);
};

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragging');
});

dropZone.addEventListener('drop', async (event: DragEvent) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');

  const filePaths = [...(event.dataTransfer?.files ?? [])]
    .flatMap((file) => {
      const directPath = (file as File & { path?: string }).path;
      if (typeof directPath === 'string' && directPath.length > 0) {
        return [directPath];
      }

      const fallbackPath = window.transcripter.queue.getPathForFile(file);
      return fallbackPath.length > 0 ? [fallbackPath] : [];
    });

  const uriList = event.dataTransfer?.getData('text/uri-list') ?? '';
  const droppedUris = uriList
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .flatMap((line) => {
      const path = fileUrlToPath(line);
      return path ? [path] : [];
    });

  const paths = [...new Set([...filePaths, ...droppedUris])];
  await addFiles(paths);
});

dropZone.addEventListener('click', () => {
  void openQueueFilePicker();
});

dropZone.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  void openQueueFilePicker();
});

addFilesButton.addEventListener('click', async () => {
  await openQueueFilePicker();
});

removeSelectedButton.addEventListener('click', async () => {
  const result = await window.transcripter.queue.removeSelected([...selectedIds]);
  if (!result.ok) {
    if (result.error) {
      window.alert(result.error);
    }
    return;
  }

  selectedIds.clear();
});

resetSelectedButton.addEventListener('click', async () => {
  const result = await window.transcripter.queue.resetSelected([...selectedIds]);
  if (!result.ok) {
    if (result.error) {
      window.alert(result.error);
    }
    return;
  }

  selectedIds.clear();
});

changeOutputSelectedButton.addEventListener('click', async () => {
  const selectedIncompleteQueueItems = queueState.items.filter(
    (item) => selectedIds.has(item.id) && item.id !== queueState.activeJobId && item.status !== 'done'
  );

  if (selectedIncompleteQueueItems.length === 0) {
    return;
  }

  const defaultPath = selectedIncompleteQueueItems[0]?.outputDirectory ?? outputDirectoryInput.value;
  const selectedPath = await window.transcripter.settings.pickOutputDirectory(defaultPath);
  if (!selectedPath) {
    return;
  }

  const result = await window.transcripter.queue.updateSelectedOutputDirectory(
    selectedIncompleteQueueItems.map((item) => item.id),
    selectedPath
  );
  if (!result.ok) {
    if (result.error) {
      window.alert(result.error);
    }
    return;
  }

  selectedIds.clear();
});

archiveCompletedButton.addEventListener('click', async () => {
  await window.transcripter.queue.archiveCompleted();
});

clearArchiveButton.addEventListener('click', async () => {
  await window.transcripter.queue.clearArchive();
});

selectAllQueuedClipsCheckbox.addEventListener('change', () => {
  const selectableQueueItemIds = queueState.items
    .filter((item) => item.id !== queueState.activeJobId)
    .map((item) => item.id);

  if (selectAllQueuedClipsCheckbox.checked) {
    selectableQueueItemIds.forEach((id) => {
      selectedIds.add(id);
    });
  } else {
    selectableQueueItemIds.forEach((id) => {
      selectedIds.delete(id);
    });
  }

  renderQueue();
});

queuePrimaryButton.addEventListener('click', async () => {
  const result = await window.transcripter.queue.start();
  if (!result.ok && result.error) {
    window.alert(result.error);
  }
});

pauseToggleButton.addEventListener('click', async () => {
  if (!queueState.hasRunningJob) {
    return;
  }

  if (queueState.isPaused) {
    await window.transcripter.queue.resume();
    return;
  }

  await window.transcripter.queue.pause();
});

stopCurrentButton.addEventListener('click', async () => {
  await window.transcripter.queue.cancelCurrent();
});

settingsTriggerButton.addEventListener('click', () => {
  setSettingsMenuOpen(settingsMenu.hidden);
});

settingsBackButton.addEventListener('click', () => {
  setSettingsMenuOpen(false);
});

toggleAnthropicApiKeyButton.addEventListener('click', () => {
  isAnthropicApiKeyVisible = !isAnthropicApiKeyVisible;
  syncAnthropicApiKeyVisibility();
});

settingsMenu.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (target && (target === settingsMenu || target.classList.contains('settings-scrim'))) {
    setSettingsMenuOpen(false);
  }
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Node)) {
    return;
  }

  const shouldCloseSettingsMenu =
    !settingsMenu.hidden && !settingsMenu.contains(event.target) && !settingsTriggerButton.contains(event.target);
  if (shouldCloseSettingsMenu) {
    setSettingsMenuOpen(false);
  }

  const shouldCloseToolsMenu = !toolsMenu.hidden && !toolsMenu.contains(event.target) && !toolsTriggerButton.contains(event.target);
  if (shouldCloseToolsMenu) {
    setToolsMenuOpen(false);
  }
});

toolsTriggerButton.addEventListener('click', () => {
  setToolsMenuOpen(toolsMenu.hidden);
});

openMergeTranscriptsButton.addEventListener('click', () => {
  setToolsMenuOpen(false);
  mergeTranscriptsModal.showModal();
});

openBuildProjectBundleButton.addEventListener('click', () => {
  setToolsMenuOpen(false);
  void resetBundleUi();
  buildProjectBundleModal.showModal();
});

closeMergeTranscriptsButton.addEventListener('click', () => {
  mergeTranscriptsModal.close();
});

closeBuildProjectBundleButton.addEventListener('click', () => {
  buildProjectBundleModal.close();
});

openPodcastSplitterButton.addEventListener('click', () => {
  setToolsMenuOpen(false);
  resetPodcastSplitterUi();
  podcastSplitterModal.showModal();
});

closePodcastSplitterButton.addEventListener('click', () => {
  podcastSplitterModal.close();
});

pickPodcastSplitterFilesButton.addEventListener('click', async () => {
  const selectedPaths = await window.transcripter.podcastSplitter.pickTranscriptFiles();
  appendPodcastSplitterPaths(selectedPaths);
});

pickPodcastSplitterOutputButton.addEventListener('click', async () => {
  const selectedPath = await window.transcripter.podcastSplitter.pickOutputFolder(podcastSplitterOutputFolderPath);
  if (!selectedPath) {
    return;
  }

  podcastSplitterOutputFolderPath = selectedPath;
  renderPodcastSplitterOutput();
  await window.transcripter.settings.set({ podcastSplitterOutputFolder: selectedPath });
});

podcastTargetMinInput.addEventListener('input', () => {
  renderPodcastSplitterFileList();
});

podcastTargetMaxInput.addEventListener('input', () => {
  renderPodcastSplitterFileList();
});

runPodcastSplitterButton.addEventListener('click', async () => {
  if (podcastSplitterSourcePaths.length === 0 || podcastSplitterOutputFolderPath.trim().length === 0) {
    return;
  }

  runPodcastSplitterButton.disabled = true;
  podcastSplitterStatusList.innerHTML = '';
  podcastSplitterStatusBuffer.splice(0, podcastSplitterStatusBuffer.length);
  podcastSplitterStatusDetails.open = false;
  setPodcastSplitterStatusBar('Starting splitter...', true);
  startPodcastSplitterStatusPump();

  const unsubscribeStatus = window.transcripter.podcastSplitter.onStatus((status) => {
    podcastSplitterStatusBuffer.push(formatPodcastSplitterStatus(status));
    if (isAiWorkingMessage(status.message)) {
      setPodcastSplitterStatusBar(`AI working... ${status.message}`, true);
      return;
    }

    setPodcastSplitterStatusBar(status.message, true);
  });

  try {
    const targetMinMinutes = Number.parseFloat(podcastTargetMinInput.value);
    const targetMaxMinutes = Number.parseFloat(podcastTargetMaxInput.value);

    const result = await window.transcripter.podcastSplitter.split({
      sourcePaths: [...podcastSplitterSourcePaths],
      outputFolderPath: podcastSplitterOutputFolderPath,
      targetMinMinutes,
      targetMaxMinutes
    });

    if (!result.ok || !result.data) {
      setPodcastSplitterStatusBar(`Failed: ${result.error ?? 'Unknown error'}`, false);
      window.alert(`Podcast splitter failed: ${result.error ?? 'Unknown error'}`);
      return;
    }

    renderPodcastSplitterResults(result.data);
    setPodcastSplitterStatusBar('Splitter complete.', false);
    window.alert(
      `Podcast splitter completed. Successes: ${result.data.successes.length}, failures: ${result.data.failures.length}. Report: ${result.data.reportPath}`
    );
  } finally {
    unsubscribeStatus();
    while (podcastSplitterStatusBuffer.length > 0) {
      const line = podcastSplitterStatusBuffer.shift();
      if (line) {
        appendPodcastSplitterStatusLine(line);
      }
    }
    stopPodcastSplitterStatusPump();
    podcastSplitterStatusSpinner.hidden = true;
    renderPodcastSplitterFileList();
  }
});
podcastSplitterDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  podcastSplitterDropZone.classList.add('dragging');
});

podcastSplitterDropZone.addEventListener('dragleave', () => {
  podcastSplitterDropZone.classList.remove('dragging');
});

podcastSplitterDropZone.addEventListener('drop', (event: DragEvent) => {
  event.preventDefault();
  podcastSplitterDropZone.classList.remove('dragging');

  const filePaths = [...(event.dataTransfer?.files ?? [])]
    .flatMap((file) => {
      const directPath = (file as File & { path?: string }).path;
      if (typeof directPath === 'string' && directPath.length > 0) {
        return [directPath];
      }

      const fallbackPath = window.transcripter.queue.getPathForFile(file);
      return fallbackPath.length > 0 ? [fallbackPath] : [];
    });

  const uriList = event.dataTransfer?.getData('text/uri-list') ?? '';
  const droppedUris = uriList
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .flatMap((line) => {
      const path = fileUrlToPath(line);
      return path ? [path] : [];
    });

  appendPodcastSplitterPaths([...new Set([...filePaths, ...droppedUris])]);
});

podcastSplitterModal.addEventListener('close', () => {
  resetPodcastSplitterUi();
});


pickBundleJobsFolderButton.addEventListener('click', async () => {
  const selectedPath = await window.transcripter.projectBundle.pickJobsFolder(bundleJobFolderPath);
  if (!selectedPath) {
    return;
  }

  bundleJobFolderPath = selectedPath;
  await appendBundleJobPathsFromFolder(selectedPath);
  await renderBundleUi();
});

pickBundleJobFilesButton.addEventListener('click', async () => {
  const selectedPaths = await window.transcripter.projectBundle.pickJobJsonFiles();
  appendBundleJobPaths(selectedPaths);
  await renderBundleUi();
});

pickBundleOutputFolderButton.addEventListener('click', async () => {
  const selectedPath = await window.transcripter.projectBundle.pickOutputFolder(bundleOutputFolderPath);
  if (!selectedPath) {
    return;
  }

  bundleOutputFolderPath = selectedPath;
  await renderBundleUi();
});

bundleProjectNameInput.addEventListener('input', () => {
  void refreshBundleOverwriteState();
});

buildProjectBundleButton.addEventListener('click', async () => {
  updateBuildBundleButtonState();
  if (buildProjectBundleButton.disabled) {
    return;
  }

  const result = await window.transcripter.projectBundle.build(getProjectBundleInput());
  if (!result.ok) {
    window.alert(`Bundle build failed: ${result.error}`);
    await refreshBundleOverwriteState();
    return;
  }

  window.alert(`Project bundle built at ${result.data.outputPath}.`);
  buildProjectBundleModal.close();
});

mergeDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  mergeDropZone.classList.add('dragging');
});

mergeDropZone.addEventListener('dragleave', () => {
  mergeDropZone.classList.remove('dragging');
});

mergeDropZone.addEventListener('drop', (event: DragEvent) => {
  event.preventDefault();
  mergeDropZone.classList.remove('dragging');

  const filePaths = [...(event.dataTransfer?.files ?? [])]
    .flatMap((file) => {
      const directPath = (file as File & { path?: string }).path;
      if (typeof directPath === 'string' && directPath.length > 0) {
        return [directPath];
      }

      const fallbackPath = window.transcripter.queue.getPathForFile(file);
      return fallbackPath.length > 0 ? [fallbackPath] : [];
    });

  const uriList = event.dataTransfer?.getData('text/uri-list') ?? '';
  const droppedUris = uriList
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .flatMap((line) => {
      const path = fileUrlToPath(line);
      return path ? [path] : [];
    });

  appendMergeTranscriptPaths([...new Set([...filePaths, ...droppedUris])]);
});

compileMergedTranscriptButton.addEventListener('click', async () => {
  if (mergeTranscriptPaths.length === 0) {
    return;
  }

  const mergedChunks = await Promise.all(
    mergeTranscriptPaths.map(async (transcriptPath) => {
      const content = await window.transcripter.file.readText(transcriptPath);
      const sourceLabel = getMergedTranscriptSourceLabel(transcriptPath);
      return `=== ${sourceLabel} ===\n${content.trim()}`;
    })
  );

  const mergedContent = mergedChunks.join('\n\n');
  const savePath = await window.transcripter.settings.pickSaveFile('merged-transcript.txt');
  if (!savePath) {
    return;
  }

  await window.transcripter.file.writeText(savePath, mergedContent);
  window.alert('Merged transcript saved.');
  mergeTranscriptsModal.close();
});

mergeTranscriptsModal.addEventListener('close', () => {
  mergeTranscriptPaths = [];
  renderMergeTranscriptList();
});

buildProjectBundleModal.addEventListener('close', () => {
  void resetBundleUi();
});

bundleJobDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  bundleJobDropZone.classList.add('dragging');
});

bundleJobDropZone.addEventListener('dragleave', () => {
  bundleJobDropZone.classList.remove('dragging');
});

bundleJobDropZone.addEventListener('drop', (event: DragEvent) => {
  event.preventDefault();
  bundleJobDropZone.classList.remove('dragging');

  const filePaths = [...(event.dataTransfer?.files ?? [])]
    .flatMap((file) => {
      const directPath = (file as File & { path?: string }).path;
      if (typeof directPath === 'string' && directPath.length > 0) {
        return [directPath];
      }

      const fallbackPath = window.transcripter.queue.getPathForFile(file);
      return fallbackPath.length > 0 ? [fallbackPath] : [];
    });

  const uriList = event.dataTransfer?.getData('text/uri-list') ?? '';
  const droppedUris = uriList
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .flatMap((line) => {
      const path = fileUrlToPath(line);
      return path ? [path] : [];
    });

  appendBundleJobPaths([...new Set([...filePaths, ...droppedUris])]);
  void renderBundleUi();
});

toggleConsoleButton.addEventListener('click', () => {
  showConsole = !showConsole;
  renderConsole();
});

pickOutputDirectoryButton.addEventListener('click', async () => {
  const selectedPath = await window.transcripter.settings.pickOutputDirectory(outputDirectoryInput.value);
  if (!selectedPath) {
    return;
  }

  outputDirectoryInput.value = selectedPath;
  await saveSettings();
});

pickIngestWatchDirectoryButton.addEventListener('click', async () => {
  const selectedPath = await window.transcripter.settings.pickIngestWatchDirectory(ingestWatchDirectoryInput.value);
  if (!selectedPath) {
    return;
  }

  ingestWatchDirectoryInput.value = selectedPath;
  await saveSettings();
});

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
});

for (const element of [
  modelSelect,
  languageSelect,
  writeRunLogCheckbox,
  txtOutputCheckbox,
  timecodedTxtOutputCheckbox,
  srtOutputCheckbox,
  vttOutputCheckbox,  anthropicApiKeyInput,
  anthropicModelInput,
  openaiTimeoutInput,
  openaiMaxRetriesInput
]) {
  element.addEventListener('change', () => {
    void saveSettings();
  });
}

ingestEnabledCheckbox.addEventListener('change', () => {
  setIngestWatchFolderPanelOpen(ingestEnabledCheckbox.checked);
  void saveSettings();
});

const bootstrap = async () => {
  const settings = await window.transcripter.settings.get();
  applySettingsToUi(settings);
  syncAnthropicApiKeyVisibility();

  const initialLogs = await window.transcripter.logs.list();
  appLogs.push(...initialLogs.slice(-MAX_CONSOLE_LINES));

  window.transcripter.logs.onEntry((entry) => {
    pushLog(entry);
  });

  window.transcripter.queue.onState((nextState) => {
    const previousActiveJobId = queueState.activeJobId;
    queueState = nextState;

    if (queueState.activeJobId !== previousActiveJobId) {
      activeJobElapsedMs = 0;
      activeJobStartedAt = queueState.activeJobId && !queueState.isPaused ? Date.now() : 0;
    }

    selectedIds.forEach((id) => {
      if (!queueState.items.some((item) => item.id === id) || id === queueState.activeJobId) {
        selectedIds.delete(id);
      }
    });

    syncActiveJobTimer();
    renderQueue();
  });

  renderConsole();
  renderMergeTranscriptList();
  resetPodcastSplitterUi();
  await refreshQueueState();
  syncActiveJobTimer();
};

void bootstrap();





























