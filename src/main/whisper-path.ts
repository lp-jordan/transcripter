import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { WhisperModel } from './types';

const whisperExecutableNames = process.platform === 'win32'
  ? ['main.exe', 'whisper.exe']
  : ['main', 'whisper'];

type RuntimePathResolution = {
  resolvedPath: string;
  candidates: string[];
  mode: 'packaged' | 'dev';
};

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

const getPackagedRuntimeCandidates = (): string[] => whisperExecutableNames.map(
  (executableName) => path.join(process.resourcesPath, 'whisper-runtime', executableName)
);

const getDevRuntimeCandidates = (appPath: string): string[] => whisperExecutableNames.flatMap((executableName) => [
  path.join(appPath, 'runtime', 'whisper-runtime', executableName),
  path.join(appPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', executableName)
]);

export const resolveWhisperPathWithMeta = (): RuntimePathResolution => {
  const appPath = app.getAppPath();
  const mode: RuntimePathResolution['mode'] = app.isPackaged ? 'packaged' : 'dev';
  const candidates = mode === 'packaged'
    ? getPackagedRuntimeCandidates()
    : getDevRuntimeCandidates(appPath);

  const resolvedPath = findExistingPath(candidates) ?? candidates[0];

  return { resolvedPath, candidates, mode };
};

export const resolveWhisperPath = (): string => resolveWhisperPathWithMeta().resolvedPath;

const getPackagedModelCandidates = (): string[] => [
  path.join(process.resourcesPath, 'whisper-models')
];

const getDevModelCandidates = (appPath: string): string[] => [
  path.join(appPath, 'runtime', 'whisper-models'),
  path.join(appPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'models')
];

export const resolveWhisperModelDirectoryWithMeta = (): RuntimePathResolution => {
  const appPath = app.getAppPath();
  const mode: RuntimePathResolution['mode'] = app.isPackaged ? 'packaged' : 'dev';
  const candidates = mode === 'packaged'
    ? getPackagedModelCandidates()
    : getDevModelCandidates(appPath);

  const resolvedPath = findExistingPath(candidates) ?? candidates[0];

  return { resolvedPath, candidates, mode };
};

export const resolveWhisperModelDirectory = (): string => resolveWhisperModelDirectoryWithMeta().resolvedPath;
