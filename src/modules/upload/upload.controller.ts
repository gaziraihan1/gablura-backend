
import { Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { AuthRequest } from '../../middleware/auth.js';
import { StorageMutation } from '../storage/storage.mutation.js';
import { StorageQuery } from '../storage/storage.query.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file provided' });
      return;
    }

    const uploadType = req.body.uploadType || 'file';

    if (uploadType === 'profile') {
      await handleProfileUpload(req, res);
      return;
    }

    await handleWorkspaceFileUpload(req, res);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload file' });
  }
};

async function handleProfileUpload(req: AuthRequest, res: Response): Promise<void> {
  const file = req.file!;

  const base64 = file.buffer.toString('base64');
  const dataURI = `data:${file.mimetype};base64,${base64}`;

  const uploadOptions: Record<string, unknown> = {
    folder: 'gablura/profiles',
    resource_type: 'auto',
  };

  if (file.mimetype.startsWith('image/')) {
    uploadOptions.transformation = [
      { width: 500, height: 500, crop: 'fill', gravity: 'face' },
      { quality: 'auto' },
      { fetch_format: 'auto' },
    ];
  }

  const result = await cloudinary.uploader.upload(dataURI, uploadOptions);

  res.status(200).json({
    success: true,
    data: {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      size: result.bytes,
    },
    message: 'Profile picture uploaded successfully',
  });
}

async function handleWorkspaceFileUpload(req: AuthRequest, res: Response): Promise<void> {
  const file = req.file!;
  const userId = req.user!.id;
  const workspaceId = req.body.workspaceId;

  if (!workspaceId) {
    res.status(400).json({
      success: false,
      message: 'Workspace ID is required for workspace/project file uploads',
    });
    return;
  }

  // Validate workspaceId format (CUID: starts with 'c', 25+ chars alphanumeric)
  if (typeof workspaceId !== 'string' || !/^c[a-z0-9]{24,}$/i.test(workspaceId)) {
    res.status(400).json({
      success: false,
      message: 'Invalid workspace ID format',
    });
    return;
  }

  const uploadCheck = await StorageMutation.canUploadFile(workspaceId, userId, file.size);

  if (!uploadCheck.allowed) {
    res.status(413).json({
      success: false,
      message: uploadCheck.reason,
    });
    return;
  }

  const base64 = file.buffer.toString('base64');
  const dataURI = `data:${file.mimetype};base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataURI, {
    folder: 'gablura/files',
    resource_type: 'auto',
  });

  try {
    const fileRecord = await StorageMutation.recordFileUpload({
      userId,
      workspaceId,
      name: result.public_id,
      originalName: file.originalname,
      size: result.bytes,
      mimeType: file.mimetype,
      url: result.secure_url,
      thumbnail: result.thumbnail_url,
      folder: req.body.folder,
      projectId: req.body.projectId,
      taskId: req.body.taskId,
    });

    const storageInfo = await StorageQuery.getWorkspaceStorageInfo(workspaceId, userId);

    res.status(200).json({
      success: true,
      data: {
        file: fileRecord,
        url: result.secure_url,
        publicId: result.public_id,
        format: result.format,
        size: result.bytes,
      },
      storageInfo,
      message: 'File uploaded successfully',
    });
  } catch {
    await cloudinary.uploader.destroy(result.public_id).catch(console.error);

    res.status(507).json({
      success: false,
      message: 'Failed to record file upload',
    });
  }
}