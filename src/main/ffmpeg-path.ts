import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const ffmpegExecutableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

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

export const resolveFfmpegPath = (): string => {
  const packagedPath = path.join(process.resourcesPath, 'ffmpeg', ffmpegExecutableName);
  const projectPath = path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', ffmpegExecutableName);

  return (
    findExistingPath([packagedPath, projectPath]) ??
    packagedPath
  );
};
