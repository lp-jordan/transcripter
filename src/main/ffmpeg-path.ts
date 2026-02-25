import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const ffmpegExecutableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

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

const getDevCandidates = (appPath: string): string[] => [
  path.join(appPath, 'runtime', 'ffmpeg', ffmpegExecutableName),
  path.join(appPath, 'node_modules', 'ffmpeg-static', ffmpegExecutableName)
];

const getPackagedCandidates = (): string[] => [
  path.join(process.resourcesPath, 'ffmpeg', ffmpegExecutableName)
];

export const resolveFfmpegPathWithMeta = (): RuntimePathResolution => {
  const appPath = app.getAppPath();
  const mode: RuntimePathResolution['mode'] = app.isPackaged ? 'packaged' : 'dev';
  const candidates = mode === 'packaged'
    ? getPackagedCandidates()
    : getDevCandidates(appPath);

  const resolvedPath = findExistingPath(candidates) ?? candidates[0];

  return { resolvedPath, candidates, mode };
};

export const resolveFfmpegPath = (): string => resolveFfmpegPathWithMeta().resolvedPath;
