import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const whisperModelsDir = path.join(repoRoot, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'models');
const baseModelPath = path.join(whisperModelsDir, 'ggml-base.bin');

const ensureBaseModel = async () => {
  try {
    await access(baseModelPath, constants.R_OK);
    console.log('[transcripter] Whisper base model already exists.');
    return;
  } catch {
    // Continue to download below.
  }

  const scriptName = process.platform === 'win32' ? 'download-ggml-model.cmd' : './download-ggml-model.sh';
  console.log('[transcripter] Downloading Whisper base model...');
  await run(scriptName, ['base'], whisperModelsDir);
};

void ensureBaseModel().catch((error) => {
  console.warn('[transcripter] Unable to prefetch Whisper base model:', error instanceof Error ? error.message : error);
  process.exit(0);
});
