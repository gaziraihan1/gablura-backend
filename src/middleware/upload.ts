import multer from 'multer';
import path from 'path';
import { Request } from 'express';

const storage = multer.memoryStorage();

const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedExtensions = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt|zip/;
  const allowedMimeTypes = /image\/.*|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\..*|text\/plain|application\/zip/;
  
  const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedMimeTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true); 
  } else {
    console.log(`Multer fileFilter rejected file: ${file.originalname}, mimetype: ${file.mimetype}`);
    cb(null, false);  
  }
};

export const upload = multer({
  storage,
  limits: {
    // Hard safety cap at the largest plan allowance (BUSINESS = 100 MB).
    // Per-workspace plan limits are enforced by requireFileSizeLimit.
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter,
});