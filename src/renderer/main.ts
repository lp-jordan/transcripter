import './style.css';
import type { ArchiveBatch } from '../main/types';
import type { AppLogEntry, QueueState } from '../preload/preload';

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
const archiveCompletedButton = document.getElementById('archive-completed') as HTMLButtonElement;
const selectAllQueuedClipsCheckbox = document.getElementById('select-all-queued-clips') as HTMLInputElement;
const selectAllLabel = document.getElementById('select-all-label') as HTMLSpanElement;
const queuePrimaryButton = document.getElementById('queue-primary') as HTMLButtonElement;
const pauseToggleButton = document.getElementById('pause-toggle') as HTMLButtonElement;
const stopCurrentButton = document.getElementById('stop-current') as HTMLButtonElement;
const settingsTriggerButton = document.getElementById('settings-trigger') as HTMLButtonElement;
const settingsMenu = document.getElementById('settings-menu') as HTMLElement;
const settingsBackButton = document.getElementById('settings-back') as HTMLButtonElement;
const toggleConsoleButton = document.getElementById('toggle-console') as HTMLButtonElement;
const consolePanel = document.getElementById('console-panel') as HTMLElement;
const consoleOutput = document.getElementById('console-output') as HTMLPreElement;
const archiveList = document.getElementById('archive-list') as HTMLUListElement;
const archiveEmptyMessage = document.getElementById('archive-empty-message') as HTMLParagraphElement;

const selectedIds = new Set<string>();
let queueState: QueueState = {
  items: [],
  archiveBatches: [],
  activeJobId: null,
  hasRunningJob: false,
  isPaused: false
};

let showConsole = false;
const appLogs: AppLogEntry[] = [];
const MAX_CONSOLE_LINES = 200;

let fitWindowTimer: ReturnType<typeof setTimeout> | null = null;

const requestWindowFitToContent = () => {
  if (fitWindowTimer) {
    clearTimeout(fitWindowTimer);
  }

  fitWindowTimer = setTimeout(() => {
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

const updateButtons = () => {
  const hasPendingItems = queueState.items.some((item) => item.status === 'pending');
  const canProcessQueue = queueState.hasRunningJob || hasPendingItems;
  const selectableQueueItems = queueState.items.filter((item) => item.id !== queueState.activeJobId);
  const selectedQueueItems = selectableQueueItems.filter((item) => selectedIds.has(item.id));
  const allSelectableQueueItemsAreSelected = selectableQueueItems.length > 0 && selectedQueueItems.length === selectableQueueItems.length;

  removeSelectedButton.disabled = selectedQueueItems.length === 0;
  archiveCompletedButton.disabled = queueState.items.every((item) => !['done', 'failed', 'canceled'].includes(item.status));
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
  summary.textContent = `${startedAt.time} — ${batch.items.length} file${batch.items.length === 1 ? '' : 's'}`;

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

    const openOutput = document.createElement('button');
    openOutput.type = 'button';
    openOutput.className = 'button-secondary archive-open-output';
    openOutput.textContent = 'Open Output Folder';
    openOutput.disabled = item.status !== 'done';
    openOutput.addEventListener('click', () => {
      void window.transcripter.queue.openOutputFolder(item.id);
    });

    fileRow.append(status, name, openOutput);
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
      const candidate = (file as File & { path?: string }).path;
      return typeof candidate === 'string' && candidate.length > 0 ? [candidate] : [];
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
  const selectedPaths = await window.transcripter.queue.pickFiles();
  await addFiles(selectedPaths);
});

removeSelectedButton.addEventListener('click', async () => {
  await window.transcripter.queue.removeSelected([...selectedIds]);
  selectedIds.clear();
});

archiveCompletedButton.addEventListener('click', async () => {
  await window.transcripter.queue.archiveCompleted();
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
    queueState = nextState;
    selectedIds.forEach((id) => {
      if (!queueState.items.some((item) => item.id === id) || id === queueState.activeJobId) {
        selectedIds.delete(id);
      }
    });
    renderQueue();
  });

  renderConsole();
  await refreshQueueState();
  window.addEventListener('resize', requestWindowFitToContent);
};

void bootstrap();
