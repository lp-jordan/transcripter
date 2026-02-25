import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const whisperExecutableNames = process.platform === 'win32'
  ? ['whisper.exe', 'whisper.cmd', 'main.exe']
  : ['whisper', 'main'];

const findExistingPath = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      continue;
    }

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

export const resolveWhisperPath = (): string => {
  const packagedCandidates = whisperExecutableNames.flatMap((executableName) => [
    path.join(process.resourcesPath, 'whisper', executableName),
    path.join(process.resourcesPath, 'node_modules', '.bin', executableName),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '.bin', executableName)
  ]);

  const appPath = app.getAppPath();
  const devCandidates = whisperExecutableNames.flatMap((executableName) => [
    path.join(appPath, 'node_modules', '.bin', executableName),
    path.join(appPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', executableName)
  ]);

  return (
    findExistingPath([...packagedCandidates, ...devCandidates]) ??
    packagedCandidates[0]
  );
};
