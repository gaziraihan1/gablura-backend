// src/tests/unit/attachment/storage.provider.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for StorageProvider — Cloudinary is mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('cloudinary', () => ({
  v2: {
    config:   vi.fn(),
    uploader: {
      upload:  vi.fn(),
      destroy: vi.fn(),
    },
  },
}));
import { v2 as cloudinary } from 'cloudinary';

import { StorageProvider } from '../../../modules/attachment/storage.provider.js';

describe('StorageProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upload', () => {
    it('uploads a file to Cloudinary with correct options', async () => {
      const mockUploadResult = {
        public_id:     'focura/attachments/file_123',
        bytes:         1000,
        secure_url:    'https://cdn.example.com/file.txt',
        thumbnail_url: null,
      };

      (cloudinary.uploader.upload as any).mockResolvedValue(mockUploadResult);

      const dataURI = 'data:text/plain;base64,aGVsbG8=';

      const result = await StorageProvider.upload(dataURI);

      expect(cloudinary.uploader.upload).toHaveBeenCalledWith(dataURI, {
        folder:        'focura/attachments',
        resource_type: 'auto',
      });
      expect(result).toEqual(mockUploadResult);
    });

    it('handles various MIME types correctly', async () => {
      const mockUploadResult = {
        public_id:     'focura/attachments/image_456',
        bytes:         5000,
        secure_url:    'https://cdn.example.com/image.png',
        thumbnail_url: 'https://cdn.example.com/image_thumb.png',
      };

      (cloudinary.uploader.upload as any).mockResolvedValue(mockUploadResult);

      const dataURI = 'data:image/png;base64,iVBORw0KGgo=';

      const result = await StorageProvider.upload(dataURI);

      expect(cloudinary.uploader.upload).toHaveBeenCalledWith(dataURI, {
        folder:        'focura/attachments',
        resource_type: 'auto',
      });
      expect(result.thumbnail_url).toBe('https://cdn.example.com/image_thumb.png');
    });

    it('throws when Cloudinary upload fails', async () => {
      (cloudinary.uploader.upload as any).mockRejectedValue(new Error('Cloudinary error'));

      const dataURI = 'data:text/plain;base64,aGVsbG8=';

      await expect(StorageProvider.upload(dataURI)).rejects.toThrow('Cloudinary error');
    });

    it('handles large file uploads', async () => {
      const mockUploadResult = {
        public_id:     'focura/attachments/large_file',
        bytes:         10 * 1024 * 1024, // 10 MB
        secure_url:    'https://cdn.example.com/large.pdf',
        thumbnail_url: null,
      };

      (cloudinary.uploader.upload as any).mockResolvedValue(mockUploadResult);

      const dataURI = 'data:application/pdf;base64,' + 'a'.repeat(1000);

      const result = await StorageProvider.upload(dataURI);

      expect(result.bytes).toBe(10 * 1024 * 1024);
    });

    it('handles video uploads', async () => {
      const mockUploadResult = {
        public_id:     'focura/attachments/video_789',
        bytes:         50 * 1024 * 1024, // 50 MB
        secure_url:    'https://cdn.example.com/video.mp4',
        thumbnail_url: 'https://cdn.example.com/video_thumb.jpg',
      };

      (cloudinary.uploader.upload as any).mockResolvedValue(mockUploadResult);

      const dataURI = 'data:video/mp4;base64,' + 'a'.repeat(1000);

      const result = await StorageProvider.upload(dataURI);

      expect(cloudinary.uploader.upload).toHaveBeenCalledWith(dataURI, {
        folder:        'focura/attachments',
        resource_type: 'auto',
      });
    });
  });

  describe('destroy', () => {
    it('destroys a file from Cloudinary by public_id', async () => {
      const mockDestroyResult = { result: 'ok' };

      (cloudinary.uploader.destroy as any).mockResolvedValue(mockDestroyResult);

      const result = await StorageProvider.destroy('focura/attachments/file_123');

      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith('focura/attachments/file_123');
      expect(result).toEqual(mockDestroyResult);
    });

    it('handles destroy when file does not exist', async () => {
      const mockDestroyResult = { result: 'not found' };

      (cloudinary.uploader.destroy as any).mockResolvedValue(mockDestroyResult);

      const result = await StorageProvider.destroy('nonexistent_file');

      expect(result).toEqual(mockDestroyResult);
    });

    it('throws when Cloudinary destroy fails', async () => {
      (cloudinary.uploader.destroy as any).mockRejectedValue(new Error('Destroy failed'));

      await expect(StorageProvider.destroy('file_123')).rejects.toThrow('Destroy failed');
    });

    it('handles destroy with special characters in public_id', async () => {
      const mockDestroyResult = { result: 'ok' };

      (cloudinary.uploader.destroy as any).mockResolvedValue(mockDestroyResult);

      const publicId = 'focura/attachments/file_with-special_chars_123';

      await StorageProvider.destroy(publicId);

      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(publicId);
    });
  });

  describe('Cloudinary configuration', () => {
    it('configures Cloudinary with environment variables', () => {
      StorageProvider.configure();
      expect(cloudinary.config).toHaveBeenCalled();
    });

    it('uses correct Cloudinary config parameters', () => {
      StorageProvider.configure();
      expect(cloudinary.config).toHaveBeenCalledWith({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key:    process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    });
  });
});
