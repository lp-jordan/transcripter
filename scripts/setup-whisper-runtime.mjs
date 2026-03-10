import { access, chmod, copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const runtimeDirectory = path.join(repoRoot, 'runtime', 'whisper-runtime');

const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false
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

const commandExists = async (command) => {
  try {
    await run(command, ['--version'], repoRoot);
    return true;
  } catch {
    return false;
  }
};

const failMissingTool = (toolName, helpText) => {
  throw new Error(`[transcripter] Missing required macOS build tool "${toolName}". ${helpText}`);
};

const ensureMacBuildTools = async () => {
  if (!(await commandExists('cmake'))) {
    failMissingTool('cmake', 'Install it with Homebrew (`brew install cmake`) and rerun npm install.');
  }

  if (!(await commandExists('xcode-select'))) {
    failMissingTool('xcode-select', 'Install Xcode Command Line Tools (`xcode-select --install`) and rerun npm install.');
  }

  try {
    await run('xcode-select', ['-p'], repoRoot);
  } catch {
    failMissingTool('Xcode Command Line Tools', 'Run `xcode-select --install` and rerun npm install.');
  }
};

const findWhisperSourceRoot = async () => {
  const candidates = [
    path.join(repoRoot, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp'),
    path.join(repoRoot, 'whisper.cpp')
  ];

  for (const candidate of candidates) {
    const stats = await stat(candidate).catch(() => null);
    if (stats?.isDirectory()) {
      return candidate;
    }
  }

  return null;
};

const executableCandidates = ['whisper-cli', 'main', 'whisper'];
const dylibNamePattern = /^lib.+\.dylib$/i;

const ensureReadable = async (candidatePath) => {
  try {
    await access(candidatePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveBuiltExecutable = async (sourceRoot) => {
  const candidates = executableCandidates.map((name) => path.join(sourceRoot, 'build', 'bin', name));

  for (const candidate of candidates) {
    if (await ensureReadable(candidate)) {
      return candidate;
    }
  }

  throw new Error(`[transcripter] Whisper build completed, but no supported executable was found in ${path.join(sourceRoot, 'build', 'bin')}.`);
};

const copySidecarLibraries = async (sourceRoot) => {
  const buildBinDirectory = path.join(sourceRoot, 'build', 'bin');

  let entries = [];
  try {
    entries = await readdir(buildBinDirectory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !dylibNamePattern.test(entry.name)) {
      continue;
    }

    const sourcePath = path.join(buildBinDirectory, entry.name);
    const targetPath = path.join(runtimeDirectory, entry.name);
    await copyFile(sourcePath, targetPath);
  }
};

const buildMacRuntime = async () => {
  const sourceRoot = await findWhisperSourceRoot();
  if (!sourceRoot) {
    throw new Error('[transcripter] Unable to locate whisper.cpp source in node_modules or the vendored repo copy.');
  }

  await ensureMacBuildTools();
  await mkdir(runtimeDirectory, { recursive: true });

  console.log(`[transcripter] Building macOS Whisper runtime from ${sourceRoot}...`);
  await run('cmake', ['-S', sourceRoot, '-B', path.join(sourceRoot, 'build'), '-DCMAKE_BUILD_TYPE=Release'], repoRoot);
  await run('cmake', ['--build', path.join(sourceRoot, 'build'), '--config', 'Release'], repoRoot);

  const builtExecutable = await resolveBuiltExecutable(sourceRoot);
  const runtimeExecutablePath = path.join(runtimeDirectory, 'main');

  await copyFile(builtExecutable, runtimeExecutablePath);
  await chmod(runtimeExecutablePath, 0o755);
  await copySidecarLibraries(sourceRoot);

  console.log(`[transcripter] macOS Whisper runtime ready at ${runtimeExecutablePath}.`);
};

const main = async () => {
  await mkdir(runtimeDirectory, { recursive: true });

  if (process.platform !== 'darwin') {
    console.log('[transcripter] Skipping macOS Whisper runtime setup on non-macOS platform.');
    return;
  }

  await buildMacRuntime();
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(message);
  process.exit(1);
});
