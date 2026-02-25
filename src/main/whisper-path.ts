import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { WhisperModel } from './types';

const whisperExecutableNames = process.platform === 'win32'
  ? ['main.exe', 'whisper.exe']
  : ['main', 'whisper'];

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

const modelFileNameByModel: Record<WhisperModel, string> = {
  tiny: 'ggml-tiny.bin',
  base: 'ggml-base.bin',
  small: 'ggml-small.bin'
};

export const getWhisperModelFileName = (model: WhisperModel): string => modelFileNameByModel[model];

export const resolveWhisperPath = (): string => {
  const packagedCandidates = whisperExecutableNames.flatMap((executableName) => [
    path.join(process.resourcesPath, 'whisper-runtime', executableName),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', executableName)
  ]);

  const appPath = app.getAppPath();
  const devCandidates = whisperExecutableNames.flatMap((executableName) => [
    path.join(appPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', executableName)
  ]);

  return findExistingPath([...packagedCandidates, ...devCandidates]) ?? packagedCandidates[0];
};

export const resolveWhisperModelDirectory = (): string => {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(process.resourcesPath, 'whisper-models'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'models'),
    path.join(appPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'models')
  ];

  return findExistingPath(candidates) ?? candidates[0];
};
