import { access, chmod, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const targetPlatform = process.env.TRANSCRIPTER_TARGET_PLATFORM ?? process.platform;
const targetArch = process.env.TRANSCRIPTER_TARGET_ARCH ?? process.arch;

const runtimeRoot = path.join(repoRoot, 'runtime');
const ffmpegRuntimeDirectory = path.join(runtimeRoot, 'ffmpeg');
const whisperRuntimeDirectory = path.join(runtimeRoot, 'whisper-runtime');
const whisperModelsRuntimeDirectory = path.join(runtimeRoot, 'whisper-models');

const ffmpegExecutableName = targetPlatform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const whisperExecutableNames = targetPlatform === 'win32'
  ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
  : ['whisper-cli', 'whisper', 'main'];

const run = (command, args, cwd = repoRoot) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env
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

const runAndCollect = (command, args, cwd = repoRoot) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: process.env
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? 'unknown'}\n${stderr || stdout}`));
    });
  });

const pathExists = async (candidatePath) => {
  try {
    await access(candidatePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const ensureDirectory = async (directoryPath) => {
  await mkdir(directoryPath, { recursive: true });
};

const cleanDirectory = async (directoryPath) => {
  await rm(directoryPath, { recursive: true, force: true });
  await mkdir(directoryPath, { recursive: true });
};

const commandExists = async (command, args = ['--version']) => {
  try {
    await runAndCollect(command, args);
    return true;
  } catch {
    return false;
  }
};

const ensureMacBuildTools = async () => {
  if (!(await commandExists('cmake'))) {
    throw new Error('[transcripter] Missing required build tool "cmake". Install it with Homebrew (`brew install cmake`).');
  }

  if (!(await commandExists('xcode-select', ['-p']))) {
    throw new Error('[transcripter] Xcode Command Line Tools are required. Run `xcode-select --install`.');
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

  throw new Error('[transcripter] Unable to locate whisper.cpp source in node_modules or a vendored repo copy.');
};

const ensureWhisperBaseModel = async () => {
  const whisperModelsSourceDirectory = path.join(repoRoot, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'models');
  const baseModelPath = path.join(whisperModelsSourceDirectory, 'ggml-base.bin');

  if (!(await pathExists(baseModelPath))) {
    const scriptName = process.platform === 'win32' ? 'download-ggml-model.cmd' : './download-ggml-model.sh';
    console.log('[transcripter] Downloading Whisper base model...');
    await run(scriptName, ['base'], whisperModelsSourceDirectory);
  }

  await cleanDirectory(whisperModelsRuntimeDirectory);

  const entries = await readdir(whisperModelsSourceDirectory);
  for (const entry of entries) {
    if (!entry.startsWith('ggml-') || !entry.endsWith('.bin')) {
      continue;
    }

    await copyFile(
      path.join(whisperModelsSourceDirectory, entry),
      path.join(whisperModelsRuntimeDirectory, entry)
    );
  }
};

const normalizeMachArch = (value) => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'x86_64') return 'x64';
  return normalized;
};

const readMachArchitectures = async (binaryPath) => {
  if (targetPlatform !== 'darwin' && process.platform !== 'darwin') {
    return [];
  }

  const { stdout } = await runAndCollect('lipo', ['-archs', binaryPath]);
  return stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeMachArch);
};

const ensureBinaryMatchesTargetArch = async (binaryPath, binaryLabel) => {
  if (targetPlatform !== 'darwin') {
    return;
  }

  const architectures = await readMachArchitectures(binaryPath);
  if (architectures.length === 0 || architectures.includes(targetArch)) {
    return;
  }

  throw new Error(
    `[transcripter] ${binaryLabel} at ${binaryPath} does not match target architecture ${targetArch}. ` +
      `Available architectures: ${architectures.join(', ')}. Build that target on a machine/dependency tree that provides the correct binary.`
  );
};

const stageFfmpegRuntime = async () => {
  await cleanDirectory(ffmpegRuntimeDirectory);

  const ffmpegSourceDirectory = path.join(repoRoot, 'node_modules', 'ffmpeg-static');
  const ffmpegSourcePath = path.join(ffmpegSourceDirectory, ffmpegExecutableName);
  const licenseSourcePath = path.join(ffmpegSourceDirectory, 'LICENSE');

  if (!(await pathExists(ffmpegSourcePath))) {
    throw new Error(`[transcripter] Missing FFmpeg binary at ${ffmpegSourcePath}. Run npm install for the target architecture first.`);
  }

  await ensureBinaryMatchesTargetArch(ffmpegSourcePath, 'FFmpeg binary');

  const stagedFfmpegPath = path.join(ffmpegRuntimeDirectory, ffmpegExecutableName);
  await copyFile(ffmpegSourcePath, stagedFfmpegPath);
  if (targetPlatform !== 'win32') {
    await chmod(stagedFfmpegPath, 0o755);
  }
  if (await pathExists(licenseSourcePath)) {
    await copyFile(licenseSourcePath, path.join(ffmpegRuntimeDirectory, 'LICENSE'));
  }
};

const getCmakeTargetArch = () => {
  if (targetPlatform !== 'darwin') {
    return null;
  }

  return targetArch === 'x64' ? 'x86_64' : targetArch;
};

const resolveBuiltWhisperExecutable = async (buildRoot) => {
  for (const entry of whisperExecutableNames) {
    const candidatePath = path.join(buildRoot, 'bin', entry);
    if (await pathExists(candidatePath)) {
      return { executablePath: candidatePath, executableName: entry };
    }
  }

  throw new Error(`[transcripter] Whisper build completed, but no supported executable was found under ${path.join(buildRoot, 'bin')}.`);
};

const collectWhisperLibraries = async (directoryPath, results = []) => {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await collectWhisperLibraries(entryPath, results);
      continue;
    }

    const isLibrary =
      (targetPlatform === 'darwin' && /^lib.+\.dylib$/i.test(entry.name)) ||
      (targetPlatform === 'linux' && /^lib.+\.so(\..+)?$/i.test(entry.name)) ||
      (targetPlatform === 'win32' && /\.dll$/i.test(entry.name));

    if (isLibrary) {
      results.push(entryPath);
    }
  }

  return results;
};

const stageWhisperRuntime = async () => {
  await cleanDirectory(whisperRuntimeDirectory);

  if (targetPlatform !== 'darwin') {
    console.log(`[transcripter] Skipping Whisper runtime build on unsupported target platform ${targetPlatform}.`);
    return;
  }

  await ensureMacBuildTools();
  const sourceRoot = await findWhisperSourceRoot();
  const buildRoot = path.join(sourceRoot, `build-${targetArch}`);
  const cmakeArch = getCmakeTargetArch();

  const configureArgs = ['-S', sourceRoot, '-B', buildRoot, '-DCMAKE_BUILD_TYPE=Release'];
  if (cmakeArch) {
    configureArgs.push(`-DCMAKE_OSX_ARCHITECTURES=${cmakeArch}`);
  }

  console.log(`[transcripter] Building Whisper runtime for ${targetPlatform}-${targetArch} from ${sourceRoot}...`);
  await run('cmake', configureArgs);
  await run('cmake', ['--build', buildRoot, '--config', 'Release']);

  const { executablePath: executableSourcePath, executableName } = await resolveBuiltWhisperExecutable(buildRoot);
  await ensureBinaryMatchesTargetArch(executableSourcePath, 'Whisper executable');
  const stagedWhisperPath = path.join(whisperRuntimeDirectory, executableName);
  await copyFile(executableSourcePath, stagedWhisperPath);
  if (targetPlatform !== 'win32') {
    await chmod(stagedWhisperPath, 0o755);
  }

  const libraries = await collectWhisperLibraries(buildRoot);
  for (const libraryPath of libraries) {
    const fileName = path.basename(libraryPath);
    await copyFile(libraryPath, path.join(whisperRuntimeDirectory, fileName));
  }
};

const main = async () => {
  await ensureDirectory(runtimeRoot);
  await stageFfmpegRuntime();
  await stageWhisperRuntime();
  await ensureWhisperBaseModel();

  console.log(
    `[transcripter] Runtime prepared for ${targetPlatform}-${targetArch} at ${runtimeRoot}.`
  );
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
