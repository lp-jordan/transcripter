import './style.css';
import type { QueueState } from '../preload/preload';

const ENABLE_PAUSE = false;

const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const queueList = document.getElementById('queue-list') as HTMLUListElement;
const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
const outputDirectoryInput = document.getElementById('output-directory') as HTMLInputElement;
const languageInput = document.getElementById('language') as HTMLInputElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;
const txtOutputCheckbox = document.getElementById('format-txt') as HTMLInputElement;
const srtOutputCheckbox = document.getElementById('format-srt') as HTMLInputElement;
const jsonOutputCheckbox = document.getElementById('format-json') as HTMLInputElement;

const addFilesButton = document.getElementById('add-files') as HTMLButtonElement;
const removeSelectedButton = document.getElementById('remove-selected') as HTMLButtonElement;
const clearCompletedButton = document.getElementById('clear-completed') as HTMLButtonElement;
const startQueueButton = document.getElementById('start-queue') as HTMLButtonElement;
const cancelCurrentButton = document.getElementById('cancel-current') as HTMLButtonElement;
const pauseQueueButton = document.getElementById('pause-queue') as HTMLButtonElement;

const selectedIds = new Set<string>();
let queueState: QueueState = {
  items: [],
  activeJobId: null,
  hasRunningJob: false
};

const updateButtons = () => {
  removeSelectedButton.disabled = selectedIds.size === 0;
  cancelCurrentButton.disabled = !queueState.hasRunningJob;
  startQueueButton.disabled = queueState.hasRunningJob || queueState.items.every((item) => item.status !== 'pending');
  pauseQueueButton.hidden = !ENABLE_PAUSE;
};

const createQueueItem = (item: QueueState['items'][number]): HTMLLIElement => {
  const li = document.createElement('li');
  li.className = 'queue-item';

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

  const details = document.createElement('div');
  details.className = 'queue-item-details';

  const status = document.createElement('strong');
  status.textContent = `${item.status} • ${Math.round(item.progress)}%`;

  const source = document.createElement('span');
  source.textContent = item.sourcePath;

  const config = document.createElement('small');
  const formats = Object.entries(item.outputOptions)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(', ');
  config.textContent = `Output: ${item.outputDirectory} | Model: ${item.model} | Language: ${item.language || 'auto'} | Formats: ${formats}`;

  details.append(status, source, config);

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

  li.append(selector, details, actions);
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
  const paths = [...(event.dataTransfer?.files ?? [])]
    .filter((file): file is File & { path: string } => 'path' in file && typeof file.path === 'string')
    .map((file) => file.path);
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

startQueueButton.addEventListener('click', async () => {
  await window.transcripter.queue.start();
});

cancelCurrentButton.addEventListener('click', async () => {
  await window.transcripter.queue.cancelCurrent();
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const next = {
    outputDirectory: outputDirectoryInput.value,
    language: languageInput.value,
    model: modelSelect.value as 'tiny' | 'base' | 'small',
    outputOptions: {
      txt: txtOutputCheckbox.checked,
      srt: srtOutputCheckbox.checked,
      json: jsonOutputCheckbox.checked
    }
  };
  const saved = await window.transcripter.settings.set(next);
  outputDirectoryInput.value = saved.outputDirectory;
  languageInput.value = saved.language;
  modelSelect.value = saved.model;
  txtOutputCheckbox.checked = saved.outputOptions.txt;
  srtOutputCheckbox.checked = saved.outputOptions.srt;
  jsonOutputCheckbox.checked = saved.outputOptions.json;
});

const bootstrap = async () => {
  const settings = await window.transcripter.settings.get();
  outputDirectoryInput.value = settings.outputDirectory;
  languageInput.value = settings.language;
  modelSelect.value = settings.model;
  txtOutputCheckbox.checked = settings.outputOptions.txt;
  srtOutputCheckbox.checked = settings.outputOptions.srt;
  jsonOutputCheckbox.checked = settings.outputOptions.json;

  window.transcripter.queue.onState((nextState) => {
    queueState = nextState;
    renderQueue();
  });

  await refreshQueueState();
};

void bootstrap();
