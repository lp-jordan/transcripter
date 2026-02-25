const percentProgressPattern = /(\d+(?:\.\d+)?)%/;
const decodeTimestampPattern = /\[(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*-->/;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const parseWhisperProgress = (line: string): number | null => {
  const match = line.match(percentProgressPattern);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  if (Number.isNaN(value)) {
    return null;
  }

  return clamp(value, 0, 100);
};

export const parseWhisperDecodeTimestampSeconds = (line: string): number | null => {
  const match = line.match(decodeTimestampPattern);
  if (!match) {
    return null;
  }

  const parts = match[1].split(':');
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }

  const hours = parts.length === 3 ? Number.parseInt(parts[0], 10) : 0;
  const minutes = Number.parseInt(parts[parts.length - 2], 10);
  const seconds = Number.parseFloat(parts[parts.length - 1]);

  if ([hours, minutes, seconds].some((value) => Number.isNaN(value))) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
};

export const parseWhisperTranscriptionProgress = (line: string, totalDurationSeconds: number): number | null => {
  const parsedPercent = parseWhisperProgress(line);
  if (parsedPercent !== null) {
    return parsedPercent;
  }

  if (!(totalDurationSeconds > 0)) {
    return null;
  }

  const decodedSeconds = parseWhisperDecodeTimestampSeconds(line);
  if (decodedSeconds === null) {
    return null;
  }

  return clamp((decodedSeconds / totalDurationSeconds) * 100, 0, 100);
};

export const clampActiveTranscriptionProgress = (progress: number): number => clamp(progress, 0, 99.5);
