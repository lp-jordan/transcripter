import './styles.css';

type QueueItem = {
  id: string;
  filePath: string;
  status: string;
};

const dropZone = document.getElementById('drop-zone') as HTMLDivElement;
const queueList = document.getElementById('queue-list') as HTMLUListElement;
const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
const outputDirectoryInput = document.getElementById('output-directory') as HTMLInputElement;
const languageInput = document.getElementById('language') as HTMLInputElement;

const renderQueue = async () => {
  const items = await window.transcripter.queue.list();
  queueList.innerHTML = '';

  for (const item of items) {
    queueList.append(createQueueItem(item));
  }
};

const createQueueItem = (item: QueueItem): HTMLLIElement => {
  const li = document.createElement('li');
  li.className = 'queue-item';

  const text = document.createElement('span');
  text.textContent = `${item.filePath} (${item.status})`;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', async () => {
    await window.transcripter.queue.remove(item.id);
    await renderQueue();
  });

  li.append(text, remove);
  return li;
};

const handleDropFiles = async (files: FileList): Promise<void> => {
  for (const file of files) {
    if ('path' in file && typeof file.path === 'string') {
      await window.transcripter.queue.add(file.path);
    }
  }
  await renderQueue();
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
  if (event.dataTransfer?.files) {
    await handleDropFiles(event.dataTransfer.files);
  }
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const next = {
    outputDirectory: outputDirectoryInput.value,
    language: languageInput.value
  };
  const saved = await window.transcripter.settings.set(next);
  outputDirectoryInput.value = saved.outputDirectory;
  languageInput.value = saved.language;
});

const bootstrap = async () => {
  const settings = await window.transcripter.settings.get();
  outputDirectoryInput.value = settings.outputDirectory;
  languageInput.value = settings.language;
  await renderQueue();
};

bootstrap();
