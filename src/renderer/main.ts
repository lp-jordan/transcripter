import './style.css';
import type { ArchiveBatch, ProjectBundleInput, ProjectBundleValidationSummary } from '../main/types';
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
const txtOutputCheckbox = document.getElementById('format-txt') as HTMLInputElement;
const timecodedTxtOutputCheckbox = document.getElementById('format-timecoded-txt') as HTMLInputElement;
const srtOutputCheckbox = document.getElementById('format-srt') as HTMLInputElement;
const vttOutputCheckbox = document.getElementById('format-vtt') as HTMLInputElement;


const addFilesButton = document.getElementById('add-files') as HTMLButtonElement;
const removeSelectedButton = document.getElementById('remove-selected') as HTMLButtonElement;
const resetSelectedButton = document.getElementById('reset-selected') as HTMLButtonElement;
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
const bundleOverwriteConfirmation = document.getElementById('bundle-overwrite-confirmation') as HTMLElement;
const bundleIncludeExports = document.getElementById('bundle-include-exports') as HTMLInputElement;
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
const appLogs: AppLogEntry[] = [];
const MAX_CONSOLE_LINES = 200;
let activeJobStartedAt = 0;
let activeJobElapsedMs = 0;
let activeJobTimer: number | null = null;

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
  overwriteConfirmed: true,
  includeExports: bundleIncludeExports.checked
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
    bundleOverwriteConfirmation.hidden = true;
    updateBuildBundleButtonState();
    return;
  }

  bundleOverwriteConfirmation.hidden = !validation.data.hasExistingProjectJson;

  updateBuildBundleButtonState();
};

const renderBundleUi = async () => {
  bundleJobsFolderDisplay.textContent = bundleJobFolderPath.length > 0 ? bundleJobFolderPath : 'No jobs folder selected.';
  bundleOutputFolderDisplay.textContent = bundleOutputFolderPath.length > 0 ? bundleOutputFolderPath : 'No output folder selected.';
  renderBundleFileList();
  await refreshBundleOverwriteState();
};

const resetBundleUi = async () => {
  bundleProjectNameInput.value = '';
  bundleJobFolderPath = '';
  bundleJobFilePaths = [];
  bundleOutputFolderPath = '';
  bundleIncludeExports.checked = false;
  bundleOverwriteConfirmation.hidden = true;
  await renderBundleUi();
};

const updateButtons = () => {
  const hasPendingItems = queueState.items.some((item) => item.status === 'pending');
  const canProcessQueue = queueState.hasRunningJob || hasPendingItems;
  const selectableQueueItems = queueState.items.filter((item) => item.id !== queueState.activeJobId);
  const selectedQueueItems = selectableQueueItems.filter((item) => selectedIds.has(item.id));
  const allSelectableQueueItemsAreSelected = selectableQueueItems.length > 0 && selectedQueueItems.length === selectableQueueItems.length;

  removeSelectedButton.disabled = selectedQueueItems.length === 0 || queueState.hasRunningJob;
  resetSelectedButton.disabled = selectedQueueItems.length === 0 || queueState.hasRunningJob;
  archiveCompletedButton.disabled = queueState.items.every((item) => !['done', 'failed', 'canceled'].includes(item.status));
  clearArchiveButton.disabled = queueState.archiveBatches.length === 0;
  stopCurrentButton.disabled = !queueState.hasRunningJob;
  pauseToggleButton.disabled = !queueState.hasRunningJob;
  pauseToggleButton.textContent = queueState.isPaused ? '▶' : '⏸';
  pauseToggleButton.setAttribute('aria-label', queueState.isPaused ? 'Resume queue' : 'Pause queue');

  selectAllQueuedClipsCheckbox.disabled = selectableQueueItems.length === 0;
  selectAllQueuedClipsCheckbox.checked = allSelectableQueueItemsAreSelected;
  selectAllQueuedClipsCheckbox.indeterminate =
    selectedQueueItems.length > 0 && !allSelectableQueueItemsAreSelected;
  selectAllLabel.textContent = allSelectableQueueItemsAreSelected ? 'Deselect All' : 'Select All';

  queuePrimaryButton.disabled = !canProcessQueue || queueState.hasRunningJob;
  queuePrimaryButton.textContent = 'Start';
};

const setSettingsMenuOpen = (isOpen: boolean) => {
  settingsMenu.hidden = !isOpen;
  settingsTriggerButton.setAttribute('aria-expanded', String(isOpen));
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

  archiveEmptyMessage.hidden = queueState.archiveBatches.length > 0;
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

const applySettingsToUi = (settings: Awaited<ReturnType<typeof window.transcripter.settings.get>>) => {
  outputDirectoryInput.value = settings.outputDirectory;
  modelSelect.value = settings.model;
  languageSelect.value = settings.language;
  if (languageSelect.value !== settings.language) {
    languageSelect.value = 'en';
  }
  writeRunLogCheckbox.checked = Boolean(settings.writeRunLog);
  txtOutputCheckbox.checked = settings.outputOptions.txt;
  timecodedTxtOutputCheckbox.checked = settings.outputOptions.timecodedTxt;
  srtOutputCheckbox.checked = settings.outputOptions.srt;
  vttOutputCheckbox.checked = settings.outputOptions.vtt;
};

const saveSettings = async () => {
  const saved = await window.transcripter.settings.set({
    outputDirectory: outputDirectoryInput.value,
    language: languageSelect.value,
    model: modelSelect.value as 'tiny' | 'base' | 'small',
    writeRunLog: writeRunLogCheckbox.checked,
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

addFilesButton.addEventListener('click', async () => {
  const selectedPaths = await window.transcripter.projectBundle.pickJobJsonFiles();
  await addFiles(selectedPaths);
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

bundleIncludeExports.addEventListener('change', () => {
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
      return content.trim();
    })
  );

  const mergedContent = mergedChunks.filter((chunk) => chunk.length > 0).join('\n\n');
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
  vttOutputCheckbox
]) {
  element.addEventListener('change', () => {
    void saveSettings();
  });
}

const bootstrap = async () => {
  const settings = await window.transcripter.settings.get();
  applySettingsToUi(settings);

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
  await refreshQueueState();
  syncActiveJobTimer();
  window.addEventListener('resize', requestWindowFitToContent);
};

void bootstrap();
