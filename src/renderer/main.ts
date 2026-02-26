import './style.css';
import type { AppLogEntry, QueueState } from '../preload/preload';

const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const queueList = document.getElementById('queue-list') as HTMLUListElement;
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
const clearCompletedButton = document.getElementById('clear-completed') as HTMLButtonElement;
const selectAllQueuedClipsCheckbox = document.getElementById('select-all-queued-clips') as HTMLInputElement;
const queuePrimaryButton = document.getElementById('queue-primary') as HTMLButtonElement;
const cancelCurrentButton = document.getElementById('cancel-current') as HTMLButtonElement;
const overflowTriggerButton = document.getElementById('overflow-trigger') as HTMLButtonElement;
const overflowMenu = document.getElementById('overflow-menu') as HTMLDivElement;
const settingsTriggerButton = document.getElementById('settings-trigger') as HTMLButtonElement;
const settingsMenu = document.getElementById('settings-menu') as HTMLElement;
const settingsBackButton = document.getElementById('settings-back') as HTMLButtonElement;
const toggleConsoleButton = document.getElementById('toggle-console') as HTMLButtonElement;
const consolePanel = document.getElementById('console-panel') as HTMLElement;
const consoleOutput = document.getElementById('console-output') as HTMLPreElement;

const selectedIds = new Set<string>();
let queueState: QueueState = {
  items: [],
  activeJobId: null,
  hasRunningJob: false,
  isPaused: false
};

let showConsole = false;
const appLogs: AppLogEntry[] = [];
const MAX_CONSOLE_LINES = 200;

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

  removeSelectedButton.disabled = selectedIds.size === 0;
  clearCompletedButton.disabled = queueState.items.every((item) => item.status !== 'done' && item.status !== 'failed');
  cancelCurrentButton.disabled = !queueState.hasRunningJob;

  selectAllQueuedClipsCheckbox.disabled = selectableQueueItems.length === 0;
  selectAllQueuedClipsCheckbox.checked = allSelectableQueueItemsAreSelected;
  selectAllQueuedClipsCheckbox.indeterminate =
    selectedQueueItems.length > 0 && !allSelectableQueueItemsAreSelected;

  queuePrimaryButton.disabled = !canProcessQueue;
  if (queueState.hasRunningJob) {
    queuePrimaryButton.textContent = queueState.isPaused ? 'Resume' : 'Pause';
  } else {
    queuePrimaryButton.textContent = 'Start';
  }
};

const setOverflowMenuOpen = (isOpen: boolean) => {
  overflowMenu.hidden = !isOpen;
  overflowTriggerButton.setAttribute('aria-expanded', String(isOpen));
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

const renderQueue = () => {
  queueList.innerHTML = '';
  for (const item of queueState.items) {
    queueList.append(createQueueItem(item));
  }
  updateButtons();
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

clearCompletedButton.addEventListener('click', async () => {
  await window.transcripter.queue.clearCompleted();
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
  if (queueState.hasRunningJob) {
    if (queueState.isPaused) {
      await window.transcripter.queue.resume();
      return;
    }

    await window.transcripter.queue.pause();
    return;
  }

  const result = await window.transcripter.queue.start();
  if (!result.ok && result.error) {
    window.alert(result.error);
  }
});

cancelCurrentButton.addEventListener('click', async () => {
  await window.transcripter.queue.cancelCurrent();
});

overflowTriggerButton.addEventListener('click', () => {
  setSettingsMenuOpen(false);
  setOverflowMenuOpen(overflowMenu.hidden);
});

settingsTriggerButton.addEventListener('click', () => {
  setOverflowMenuOpen(false);
  setSettingsMenuOpen(settingsMenu.hidden);
});

settingsBackButton.addEventListener('click', () => {
  setSettingsMenuOpen(false);
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Node)) {
    return;
  }

  const shouldCloseOverflowMenu =
    !overflowMenu.hidden && !overflowMenu.contains(event.target) && !overflowTriggerButton.contains(event.target);
  if (shouldCloseOverflowMenu) {
    setOverflowMenuOpen(false);
  }

  const shouldCloseSettingsMenu =
    !settingsMenu.hidden && !settingsMenu.contains(event.target) && !settingsTriggerButton.contains(event.target);
  if (shouldCloseSettingsMenu) {
    setSettingsMenuOpen(false);
  }
});

removeSelectedButton.addEventListener('click', () => {
  setOverflowMenuOpen(false);
});

clearCompletedButton.addEventListener('click', () => {
  setOverflowMenuOpen(false);
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
};

void bootstrap();
