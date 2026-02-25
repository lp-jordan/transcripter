import assert from 'node:assert/strict';
import test from 'node:test';
import { formatClockTimestamp, formatSrtTimestamp, formatVttTimestamp, mergedNormalizedText, normalizeText } from './formatting';

test('formatClockTimestamp uses zero-padded HH:MM:SS', () => {
  assert.equal(formatClockTimestamp(0), '00:00:00');
  assert.equal(formatClockTimestamp(5), '00:00:05');
  assert.equal(formatClockTimestamp(3661.9), '01:01:01');
});

test('subtitle timestamps include milliseconds in expected delimiter format', () => {
  assert.equal(formatSrtTimestamp(65.432), '00:01:05,432');
  assert.equal(formatVttTimestamp(65.432), '00:01:05.432');
});

test('text normalization collapses and trims spacing', () => {
  assert.equal(normalizeText('  hello\n\n   world\t  '), 'hello world');
  assert.equal(
    mergedNormalizedText([
      { start: 0, end: 1, text: ' hello   there ' },
      { start: 1, end: 2, text: '\n general\tkenobi  ' }
    ]),
    'hello there general kenobi'
  );
});
