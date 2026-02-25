import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWhisperDecodeTimestampSeconds,
  parseWhisperProgress,
  parseWhisperTranscriptionProgress
} from './whisper-progress';

test('parseWhisperProgress reads percent progress lines', () => {
  assert.equal(parseWhisperProgress('whisper: 12.4% complete'), 12.4);
  assert.equal(parseWhisperProgress('done 100%'), 100);
  assert.equal(parseWhisperProgress('bad: abc%'), null);
});

test('parseWhisperDecodeTimestampSeconds reads timestamped decode lines', () => {
  assert.equal(parseWhisperDecodeTimestampSeconds('[00:01:23.45 --> 00:01:25.00] hello'), 83.45);
  assert.equal(parseWhisperDecodeTimestampSeconds('[1:02:03.5 --> 1:02:04.0] hello'), 3723.5);
  assert.equal(parseWhisperDecodeTimestampSeconds('[02:03.75 --> 02:04.00] hello'), 123.75);
});

test('parseWhisperTranscriptionProgress prefers percent and falls back to timestamp lines', () => {
  assert.equal(parseWhisperTranscriptionProgress('progress 88%', 300), 88);
  assert.equal(parseWhisperTranscriptionProgress('[00:01:30.00 --> 00:01:31.00] segment', 180), 50);
});

test('parseWhisperTranscriptionProgress ignores noisy and malformed lines', () => {
  assert.equal(parseWhisperTranscriptionProgress('random log line', 180), null);
  assert.equal(parseWhisperTranscriptionProgress('[foo --> bar] malformed', 180), null);
  assert.equal(parseWhisperTranscriptionProgress('[00:00:10.00 --> 00:00:11.00] segment', 0), null);
});
