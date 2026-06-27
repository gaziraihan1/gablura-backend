// src/tests/unit/file/fileManagement.utils.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pure-function tests for fileManagement.utils.ts — no mocks needed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { bytesToMB, categorizeFileType } from '../../../modules/file/fileManagement.utils.js';

describe('bytesToMB', () => {
  it('converts 0 bytes to 0 MB', () => {
    expect(bytesToMB(0)).toBe(0);
  });

  it('converts exactly 1 MB (1048576 bytes) to 1 MB', () => {
    expect(bytesToMB(1048576)).toBe(1);
  });

  it('rounds to 2 decimal places', () => {
    // 1.5 MB = 1572864 bytes
    expect(bytesToMB(1572864)).toBe(1.5);
  });

  it('handles large values (100 MB)', () => {
    expect(bytesToMB(100 * 1024 * 1024)).toBe(100);
  });

  it('rounds correctly for non-integer results', () => {
    // 1234567 bytes ≈ 1.18 MB
    expect(bytesToMB(1234567)).toBe(1.18);
  });
});

describe('categorizeFileType', () => {
  it('categorizes images correctly', () => {
    expect(categorizeFileType('image/jpeg')).toBe('Images');
    expect(categorizeFileType('image/png')).toBe('Images');
    expect(categorizeFileType('image/gif')).toBe('Images');
    expect(categorizeFileType('image/webp')).toBe('Images');
    expect(categorizeFileType('image/svg+xml')).toBe('Images');
  });

  it('categorizes videos correctly', () => {
    expect(categorizeFileType('video/mp4')).toBe('Videos');
    expect(categorizeFileType('video/mpeg')).toBe('Videos');
    expect(categorizeFileType('video/quicktime')).toBe('Videos');
  });

  it('categorizes audio correctly', () => {
    expect(categorizeFileType('audio/mpeg')).toBe('Audio');
    expect(categorizeFileType('audio/wav')).toBe('Audio');
  });

  it('categorizes PDFs correctly', () => {
    expect(categorizeFileType('application/pdf')).toBe('PDFs');
  });

  it('categorizes documents correctly', () => {
    expect(categorizeFileType('application/msword')).toBe('Documents');
    expect(categorizeFileType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Documents');
    expect(categorizeFileType('application/vnd.ms-excel')).toBe('Documents');
    expect(categorizeFileType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('Documents');
    expect(categorizeFileType('application/vnd.ms-powerpoint')).toBe('Documents');
    expect(categorizeFileType('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('Documents');
  });

  it('categorizes archives correctly', () => {
    expect(categorizeFileType('application/zip')).toBe('Archives');
    expect(categorizeFileType('application/x-rar-compressed')).toBe('Archives');
    expect(categorizeFileType('application/x-7z-compressed')).toBe('Archives');
  });

  it('returns "Other" for unknown mime types', () => {
    expect(categorizeFileType('text/plain')).toBe('Other');
    expect(categorizeFileType('application/json')).toBe('Other');
  });
});
