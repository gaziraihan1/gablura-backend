import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { uploadFile } from '../../../modules/upload/upload.controller.js';
import { v2 as cloudinary } from 'cloudinary';
import { StorageMutation } from '../../../modules/storage/storage.mutation.js';
import { StorageQuery } from '../../../modules/storage/storage.query.js';
import { Response } from 'express';
import { AuthRequest } from '../../../middleware/auth.js';

vi.mock('cloudinary', () => {
  const v2: any = {
    config: vi.fn(),
    uploader: {
      upload: vi.fn(),
      destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
    },
  };
  v2.v2 = v2;
  return { v2 };
});
vi.mock('../../../modules/storage/storage.mutation.js');
vi.mock('../../../modules/storage/storage.query.js');

// Mock the queue module to prevent job execution in tests
vi.mock('../../../queue/index.js', () => ({
  addInvalidateCacheJob: vi.fn().mockResolvedValue(undefined),
}));

describe('UploadController', () => {
  let mockRequest: Partial<AuthRequest>;
  let mockResponse: Partial<Response>;
  let jsonMock: Mock;
  let statusMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockResponse = {
      status: statusMock,
    };

    mockRequest = {
      user: { id: 'user-123', email: 'test@example.com', role: 'MEMBER' },
      file: {
        buffer: Buffer.from('test-file-content'),
        mimetype: 'image/jpeg',
        originalname: 'test.jpg',
        size: 1024,
      } as any,
      body: {},
    };
  });

  describe('uploadFile - Basic Validation', () => {
    it('should return 401 if user is not authenticated', async () => {
      mockRequest.user = undefined;

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ success: false, message: 'Unauthorized' });
    });

    it('should return 400 if no file is provided', async () => {
      mockRequest.file = undefined;

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ success: false, message: 'No file provided' });
    });
  });

  describe('uploadFile - Profile Upload', () => {
    beforeEach(() => {
      mockRequest.body.uploadType = 'profile';
    });

    it('should upload profile picture and return 200', async () => {
      const mockCloudinaryResult = {
        secure_url: 'https://cloudinary.com/profile.jpg',
        public_id: 'profile_123',
        format: 'jpg',
        bytes: 1024,
      };
      (cloudinary.uploader.upload as any).mockResolvedValue(mockCloudinaryResult);

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      expect(cloudinary.uploader.upload).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: {
          url: mockCloudinaryResult.secure_url,
          publicId: mockCloudinaryResult.public_id,
          format: mockCloudinaryResult.format,
          size: mockCloudinaryResult.bytes,
        },
        message: 'Profile picture uploaded successfully',
      });
    });

    it('should apply image transformations for images', async () => {
      mockRequest.file!.mimetype = 'image/png';
      (cloudinary.uploader.upload as any).mockResolvedValue({ secure_url: '...', public_id: '...', format: '...', bytes: 123 });

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      const uploadArgs = (cloudinary.uploader.upload as any).mock.calls[0][1];
      expect(uploadArgs).toHaveProperty('transformation');
    });

    it('should not apply transformations for non-image files', async () => {
      mockRequest.file!.mimetype = 'application/pdf';
      (cloudinary.uploader.upload as any).mockResolvedValue({ secure_url: '...', public_id: '...', format: '...', bytes: 123 });

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      const uploadArgs = (cloudinary.uploader.upload as any).mock.calls[0][1];
      expect(uploadArgs).not.toHaveProperty('transformation');
    });

    it('should return 500 if cloudinary upload fails', async () => {
      (cloudinary.uploader.upload as any).mockRejectedValue(new Error('Cloudinary Error'));

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ success: false, message: 'Failed to upload file' });
    });
  });

  describe('uploadFile - Workspace Upload', () => {
    beforeEach(() => {
      mockRequest.body.uploadType = 'file';
      mockRequest.body.workspaceId = 'clj1234567890abcdefghijklmnopqrstuvwxyz'; // Valid CUID format
    });

    it('should return 400 if workspaceId is missing', async () => {
      delete mockRequest.body.workspaceId;

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Workspace ID is required for workspace/project file uploads',
      });
    });

    it('should return 413 if storage quota is exceeded', async () => {
      // Ensure workspaceId is valid CUID format
      mockRequest.body.workspaceId = 'clj1234567890abcdefghijklmnopqrstuvwxyz';
      
      (StorageMutation.canUploadFile as any).mockResolvedValue({
        allowed: false,
        reason: 'Storage quota exceeded',
      });

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(413);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Storage quota exceeded',
      });
    });

    it('should upload file, record in DB, and return 200', async () => {
      // Ensure workspaceId is valid CUID format
      mockRequest.body.workspaceId = 'clj1234567890abcdefghijklmnopqrstuvwxyz';
      
      const mockCloudinaryResult = {
        secure_url: 'https://cloudinary.com/file.jpg',
        public_id: 'file_123',
        format: 'jpg',
        bytes: 1024,
        thumbnail_url: 'https://cloudinary.com/thumb.jpg',
      };
      const mockFileRecord = { id: 'file-record-123', ...mockCloudinaryResult };
      const mockStorageInfo = { used: 1024, total: 10485760 };

      (StorageMutation.canUploadFile as any).mockResolvedValue({ allowed: true });
      (cloudinary.uploader.upload as any).mockResolvedValue(mockCloudinaryResult);
      (StorageMutation.recordFileUpload as any).mockResolvedValue(mockFileRecord);
      (StorageQuery.getWorkspaceStorageInfo as any).mockResolvedValue(mockStorageInfo);

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      expect(cloudinary.uploader.upload).toHaveBeenCalled();
      expect(StorageMutation.recordFileUpload).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: {
          file: mockFileRecord,
          url: mockCloudinaryResult.secure_url,
          publicId: mockCloudinaryResult.public_id,
          format: mockCloudinaryResult.format,
          size: mockCloudinaryResult.bytes,
        },
        storageInfo: mockStorageInfo,
        message: 'File uploaded successfully',
      });
    });

    it('should destroy cloudinary file if database recording fails', async () => {
      // Ensure workspaceId is valid CUID format
      mockRequest.body.workspaceId = 'clj1234567890abcdefghijklmnopqrstuvwxyz';
      
      const mockCloudinaryResult = {
        secure_url: 'https://cloudinary.com/file.jpg',
        public_id: 'file_123',
        format: 'jpg',
        bytes: 1024,
      };

      (StorageMutation.canUploadFile as any).mockResolvedValue({ allowed: true });
      (cloudinary.uploader.upload as any).mockResolvedValue(mockCloudinaryResult);
      (StorageMutation.recordFileUpload as any).mockRejectedValue(new Error('DB Error'));

      await uploadFile(mockRequest as AuthRequest, mockResponse as Response);

      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(mockCloudinaryResult.public_id);
      expect(statusMock).toHaveBeenCalledWith(507);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to record file upload',
      });
    });
  });
});
