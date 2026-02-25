import './style.css';
import type { AppLogEntry, QueueState } from '../preload/preload';
import type { AppSettings, OutputOptions } from '../main/types';

const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const queueList = document.getElementById('queue-list') as HTMLUListElement;
const queueSettingsSummary = document.getElementById('queue-settings-summary') as HTMLElement;
const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
const outputDirectoryInput = document.getElementById('output-directory') as HTMLInputElement;
const pickOutputDirectoryButton = document.getElementById('pick-output-directory') as HTMLButtonElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;
const txtOutputCheckbox = document.getElementById('format-txt') as HTMLInputElement;
const timecodedTxtOutputCheckbox = document.getElementById('format-timecoded-txt') as HTMLInputElement;
const srtOutputCheckbox = document.getElementById('format-srt') as HTMLInputElement;
const vttOutputCheckbox = document.getElementById('format-vtt') as HTMLInputElement;
const jsonOutputCheckbox = document.getElementById('format-json') as HTMLInputElement;

const addFilesButton = document.getElementById('add-files') as HTMLButtonElement;
const removeSelectedButton = document.getElementById('remove-selected') as HTMLButtonElement;
const clearCompletedButton = document.getElementById('clear-completed') as HTMLButtonElement;
const queuePrimaryButton = document.getElementById('queue-primary') as HTMLButtonElement;
const cancelCurrentButton = document.getElementById('cancel-current') as HTMLButtonElement;
const overflowTriggerButton = document.getElementById('overflow-trigger') as HTMLButtonElement;
const overflowMenu = document.getElementById('overflow-menu') as HTMLDivElement;
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
const FORMAT_LABELS: Record<keyof OutputOptions, string> = {
  txt: 'TXT',
  timecodedTxt: 'Timecoded TXT',
  srt: 'SRT',
  vtt: 'VTT',
  json: 'JSON'
};

let currentSettings: AppSettings = {
  outputDirectory: '',
  language: 'en',
  model: 'tiny',
  outputOptions: {
    txt: false,
    timecodedTxt: false,
    srt: false,
    vtt: false,
    json: false
  }
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

  removeSelectedButton.disabled = selectedIds.size === 0;
  clearCompletedButton.disabled = queueState.items.every((item) => item.status !== 'done');
  cancelCurrentButton.disabled = !queueState.hasRunningJob;

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

const formatLogEntry = (entry: AppLogEntry): string => {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const level = entry.level.toUpperCase().padEnd(5, ' ');
  return `[${time}] ${level} ${entry.message}`;
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

const getEnabledFormats = (outputOptions: OutputOptions): string[] =>
  Object.entries(outputOptions)
    .filter(([, enabled]) => enabled)
    .map(([format]) => FORMAT_LABELS[format as keyof OutputOptions]);

const formatLanguageLabel = (language: string): string => {
  if (language.toLowerCase() === 'en') {
    return 'English';
  }

  return language;
};

const renderQueueSettingsSummary = () => {
  const enabledFormats = getEnabledFormats(currentSettings.outputOptions);
  const summaryParts = [
    `Output: ${currentSettings.outputDirectory}`,
    `Model: ${currentSettings.model}`,
    `Language: ${formatLanguageLabel(currentSettings.language)}`,
    `Formats: ${enabledFormats.length > 0 ? enabledFormats.join(', ') : 'None'}`
  ];

  queueSettingsSummary.textContent = summaryParts.join(' • ');
  queueSettingsSummary.title = queueSettingsSummary.textContent;
};

const createQueueItem = (item: QueueState['items'][number]): HTMLLIElement => {
  const li = document.createElement('li');
  li.className = 'queue-item';

  const details = document.createElement('div');
  details.className = 'queue-item-details';

  const header = document.createElement('div');
  header.className = 'queue-item-header';

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

  const status = document.createElement('strong');
  status.className = 'queue-item-status';
  status.textContent = `${formatStatusLabel(item.status)} • ${Math.round(item.progress)}%`;

  header.append(title, status);

  const itemOverrides: string[] = [];
  if (item.outputDirectory !== currentSettings.outputDirectory) {
    itemOverrides.push(`Output: ${item.outputDirectory}`);
  }

  if (item.model !== currentSettings.model) {
    itemOverrides.push(`Model: ${item.model}`);
  }

  if (item.language !== currentSettings.language) {
    itemOverrides.push(`Language: ${formatLanguageLabel(item.language)}`);
  }

  const itemFormats = getEnabledFormats(item.outputOptions);
  const defaultFormats = getEnabledFormats(currentSettings.outputOptions);
  if (itemFormats.join('|') !== defaultFormats.join('|')) {
    itemOverrides.push(`Formats: ${itemFormats.length > 0 ? itemFormats.join(', ') : 'None'}`);
  }

  details.append(header);
  if (itemOverrides.length > 0) {
    const config = document.createElement('small');
    config.className = 'queue-item-meta';
    config.textContent = `Overrides: ${itemOverrides.join(' • ')}`;
    details.append(config);
  }

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

  li.append(details, actions);
  return li;
};

const renderQueue = () => {
  renderQueueSettingsSummary();
  queueList.innerHTML = '';
  for (const item of queueState.items) {
    queueList.append(createQueueItem(item));
  }
  updateButtons();
};

const refreshQueueState = async () => {
  queueState = await window.transcripter.queue.list();
  selectedIds.forEach((id) => {
    if (!queueState.items.some((item) => item.id === id)) {
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

const saveSettings = async () => {
  const saved = await window.transcripter.settings.set({
    outputDirectory: outputDirectoryInput.value,
    language: 'en',
    model: modelSelect.value as 'tiny' | 'base' | 'small',
    outputOptions: {
      txt: txtOutputCheckbox.checked,
      timecodedTxt: timecodedTxtOutputCheckbox.checked,
      srt: srtOutputCheckbox.checked,
      vtt: vttOutputCheckbox.checked,
      json: jsonOutputCheckbox.checked
    }
  });

  currentSettings = saved;

  outputDirectoryInput.value = saved.outputDirectory;
  modelSelect.value = saved.model;
  txtOutputCheckbox.checked = saved.outputOptions.txt;
  timecodedTxtOutputCheckbox.checked = saved.outputOptions.timecodedTxt;
  srtOutputCheckbox.checked = saved.outputOptions.srt;
  vttOutputCheckbox.checked = saved.outputOptions.vtt;
  jsonOutputCheckbox.checked = saved.outputOptions.json;
  renderQueue();
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
  setOverflowMenuOpen(overflowMenu.hidden);
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Node)) {
    return;
  }

  if (overflowMenu.hidden) {
    return;
  }

  if (!overflowMenu.contains(event.target) && !overflowTriggerButton.contains(event.target)) {
    setOverflowMenuOpen(false);
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

for (const element of [modelSelect, txtOutputCheckbox, timecodedTxtOutputCheckbox, srtOutputCheckbox, vttOutputCheckbox, jsonOutputCheckbox]) {
  element.addEventListener('change', () => {
    void saveSettings();
  });
}

const bootstrap = async () => {
  const settings = await window.transcripter.settings.get();
  currentSettings = settings;
  outputDirectoryInput.value = settings.outputDirectory;
  modelSelect.value = settings.model;
  txtOutputCheckbox.checked = settings.outputOptions.txt;
  timecodedTxtOutputCheckbox.checked = settings.outputOptions.timecodedTxt;
  srtOutputCheckbox.checked = settings.outputOptions.srt;
  vttOutputCheckbox.checked = settings.outputOptions.vtt;
  jsonOutputCheckbox.checked = settings.outputOptions.json;

  renderQueueSettingsSummary();

  const initialLogs = await window.transcripter.logs.list();
  appLogs.push(...initialLogs.slice(-MAX_CONSOLE_LINES));

  window.transcripter.logs.onEntry((entry) => {
    pushLog(entry);
  });

  window.transcripter.queue.onState((nextState) => {
    queueState = nextState;
    renderQueue();
  });

  renderConsole();
  await refreshQueueState();
};

void bootstrap();
