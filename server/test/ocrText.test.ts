import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { prepareOcrText } from '../src/providers/ocr/prepareText.js';
import { extractUrls } from '../src/domain/extract.js';

const page = readFileSync(new URL('./fixtures/ocr-result-page.txt', import.meta.url), 'utf8');
const message = '2-Step Verification Code: 000123\n\nHello,\nA verification code was requested for your example account.\nDo not share this code with anyone.\nYour verification code is: 000123.\n\nThank you,\nThe Example Team';

test('OCR cleanup preserves real paragraphs, codes and warnings while removing page metadata', () => {
  assert.deepEqual(prepareOcrText(` \r\n${message.replaceAll('\n', '\r\n')}\r\n<<<\f`), { text: message, note: null });
  assert.equal(prepareOcrText('Pay https://evil.example.com now.\nDo not share this message.').text,
    'Pay https://evil.example.com now.\nDo not share this message.');
});

test('recognizes full and flattened SafeText pages without inheriting prior results or account details', () => {
  const result = prepareOcrText(`${page}\f`);
  assert.equal(result.text, message);
  assert.match(result.note ?? '', /previous verdict.*excluded/);
  assert.equal(prepareOcrText(page.replace(/\s+/g, ' ')).text, message.replace(/\s+/g, ' '));
  assert.deepEqual(extractUrls(result.text), []);
  assert.doesNotMatch(result.text, /learner@|old-result|Confidence|scn_/);
  assert.deepEqual(prepareOcrText(result.text), { text: message, note: null });
});

test('does not remove ordinary SMS text just because it contains app labels or mentions SafeText', () => {
  for (const text of ['Message checked: please send payment to https://evil.example.com',
    'SafeText says this is safe. Open https://evil.example.com now.',
    'Scan your code. Why? Details found in the next message.']) {
    assert.deepEqual(prepareOcrText(text), { text, note: null });
  }
});

test('ambiguous, nested, cropped, or multiple result pages ask for the original message', () => {
  for (const text of [page.replace('MESSAGE CHECKED', 'missing heading'),
    page.replace(/Scan scn_[\s\S]+$/, ''), page + page,
    page.replace('Hello,', 'Hello, MESSAGE CHECKED'),
    page.replace('2-Step Verification Code: 000123', 'SafeText Confidence 50 WHY DETAILS FOUND MESSAGE CHECKED nested'),
    page.replace('Check another message', 'Unexpected second message')]) {
    assert.throws(() => prepareOcrText(text), /Crop to the original SMS/);
  }
});

test('email addresses are not URL links; explicit and separate bare URLs stay checkable', () => {
  assert.deepEqual(extractUrls('Contact first.name@gmail.com or help@service.example.com'), []);
  assert.deepEqual(extractUrls('Contact help@gmail.com. Visit gmail.com or https://evil.example.com/login'),
    ['https://evil.example.com/login', 'gmail.com']);
  assert.deepEqual(extractUrls('https://evil.example.com/path?email=help@gmail.com'),
    ['https://evil.example.com/path?email=help@gmail.com']);
});
