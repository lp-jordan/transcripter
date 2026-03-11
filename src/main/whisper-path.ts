import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { WhisperModel } from './types';

const whisperExecutableNames = process.platform === 'win32'
  ? ['whisper-cli.exe', 'whisper.exe', 'main.exe']
  : ['whisper-cli', 'whisper', 'main'];

type RuntimePathResolution = {
  resolvedPath: string;
  candidates: string[];
  mode: 'packaged' | 'dev';
};

const findExecutablePath = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      continue;
    }

    try {
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue searching for an executable candidate.
    }
  }

  return null;
};

const findReadablePath = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      continue;
    }

    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // Continue searching for a readable candidate.
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

const getDevRuntimeCandidates = (appPath: string): string[] => {
  const baseDirectories = [
    path.join(appPath, 'runtime', 'whisper-runtime'),
    path.join(appPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp'),
    path.join(appPath, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp', 'build', 'bin'),
    path.join(appPath, 'whisper.cpp'),
    path.join(appPath, 'whisper.cpp', 'build', 'bin')
  ];

  return baseDirectories.flatMap((directory) => whisperExecutableNames.map((executableName) => path.join(directory, executableName)));
};

export const resolveWhisperPathWithMeta = (): RuntimePathResolution => {
  const appPath = app.getAppPath();
  const mode: RuntimePathResolution['mode'] = app.isPackaged ? 'packaged' : 'dev';
  const candidates = mode === 'packaged'
    ? getPackagedRuntimeCandidates()
    : getDevRuntimeCandidates(appPath);

  const resolvedPath = findExecutablePath(candidates) ?? candidates[0];

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

  const resolvedPath = findReadablePath(candidates) ?? candidates[0];

  return { resolvedPath, candidates, mode };
};

export const resolveWhisperModelDirectory = (): string => resolveWhisperModelDirectoryWithMeta().resolvedPath;
