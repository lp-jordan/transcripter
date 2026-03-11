import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import builder from 'electron-builder';

const { build, Arch, Platform } = builder;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const releaseDirectory = path.join(repoRoot, 'release');

const args = new Set(process.argv.slice(2));

const parseExplicitArch = () => {
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith('--arch=')) {
      return argument.slice('--arch='.length);
    }
  }

  return null;
};

const run = (command, commandArgs, extraEnv = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ...extraEnv }
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

const compareVersions = (left, right) => {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));

  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
};

const incrementPatchVersion = (version) => {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10));
  return `${major}.${minor}.${(patch ?? 0) + 1}`;
};

const resolveBuildVersion = async (packageVersion) => {
  const releaseEntries = await readdir(releaseDirectory).catch(() => []);
  const foundVersions = new Set();

  for (const entry of releaseEntries) {
    const match = entry.match(/-(\d+\.\d+\.\d+)-/);
    if (match) {
      foundVersions.add(match[1]);
    }
  }

  if (foundVersions.size === 0) {
    return packageVersion;
  }

  const sortedVersions = [...foundVersions].sort(compareVersions);
  const highestVersion = sortedVersions[sortedVersions.length - 1];

  return compareVersions(highestVersion, packageVersion) >= 0 ? incrementPatchVersion(highestVersion) : packageVersion;
};

const resolveTargetPlatform = () => {
  if (args.has('--mac')) return 'mac';
  if (args.has('--win')) return 'win';
  if (args.has('--linux')) return 'linux';

  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'win';
  return 'linux';
};

const resolveTargetArchitectures = (targetPlatform) => {
  const explicitArch = parseExplicitArch();
  if (explicitArch && explicitArch !== 'all') {
    return [explicitArch];
  }

  if (explicitArch === 'all') {
    if (targetPlatform === 'mac') return ['x64', 'arm64'];
    return [process.arch];
  }

  return [process.arch];
};

const readPackageMetadata = async () => {
  const raw = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
  return JSON.parse(raw);
};

const resolvePlatformConfig = (targetPlatform, buildConfig) => {
  if (targetPlatform === 'mac') return buildConfig.mac ?? {};
  if (targetPlatform === 'win') return buildConfig.win ?? {};
  return buildConfig.linux ?? {};
};

const resolveTargetNames = (targetPlatform, buildConfig) => {
  const platformConfig = resolvePlatformConfig(targetPlatform, buildConfig);
  const configuredTargets = Array.isArray(platformConfig.target) ? platformConfig.target : [];
  const names = configuredTargets
    .map((entry) => (typeof entry === 'string' ? entry : entry?.target))
    .filter(Boolean);

  if (names.length > 0) {
    return names;
  }

  if (targetPlatform === 'mac') return ['dmg', 'zip'];
  if (targetPlatform === 'win') return ['nsis'];
  return ['AppImage'];
};

const resolveBuilderPlatform = (targetPlatform) => {
  if (targetPlatform === 'mac') return Platform.MAC;
  if (targetPlatform === 'win') return Platform.WINDOWS;
  return Platform.LINUX;
};

const resolveBuilderArch = (targetArchitecture) => {
  if (targetArchitecture === 'arm64') return Arch.arm64;
  if (targetArchitecture === 'x64') return Arch.x64;
  throw new Error(`[transcripter] Unsupported architecture "${targetArchitecture}".`);
};

const main = async () => {
  const packageMetadata = await readPackageMetadata();
  const packageVersion = packageMetadata.version;
  const targetPlatform = resolveTargetPlatform();
  const targetArchitectures = resolveTargetArchitectures(targetPlatform);
  const buildVersion = await resolveBuildVersion(packageVersion);
  const targetNames = resolveTargetNames(targetPlatform, packageMetadata.build ?? {});
  const builderPlatform = resolveBuilderPlatform(targetPlatform);

  console.log(`[transcripter] Packaging ${targetPlatform} build version ${buildVersion} for ${targetArchitectures.join(', ')}.`);

  await run('npm', ['run', 'build']);

  for (const targetArchitecture of targetArchitectures) {
    console.log(`[transcripter] Preparing runtime for ${targetPlatform}-${targetArchitecture}...`);
    await run('node', ['scripts/prepare-runtime.mjs'], {
      TRANSCRIPTER_TARGET_PLATFORM: targetPlatform === 'mac' ? 'darwin' : process.platform,
      TRANSCRIPTER_TARGET_ARCH: targetArchitecture
    });

    await build({
      targets: builderPlatform.createTarget(targetNames, resolveBuilderArch(targetArchitecture)),
      config: {
        ...packageMetadata.build,
        extraMetadata: {
          ...(packageMetadata.build?.extraMetadata ?? {}),
          version: buildVersion
        }
      }
    });
  }
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
