import type { Segment } from '../types';

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const normalizeText = (value: string): string => collapseWhitespace(value);

export const normalizeSegmentText = (segment: Pick<Segment, 'text'>): string => collapseWhitespace(segment.text);

export const mergedNormalizedText = (segments: Segment[]): string =>
  collapseWhitespace(segments.map((segment) => normalizeSegmentText(segment)).filter(Boolean).join(' '));

export const formatClockTimestamp = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export const formatSrtTimestamp = (seconds: number): string => {
  const millis = Math.max(0, Math.floor(seconds * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

export const formatVttTimestamp = (seconds: number): string => {
  const millis = Math.max(0, Math.floor(seconds * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  const ms = millis % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};
