import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { createWorkspaceWithOwner } from '../factories/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { cloudinary } from 'cloudinary';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload: vi.fn().mockResolvedValue({
        secure_url: 'https://cloudinary.com/test.png',
        public_id: 'test_id',
        format: 'png',
        bytes: 1024,
        thumbnail_url: 'https://cloudinary.com/thumb.png',
      }),
      destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
    },
  },
}));

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (global.testUser) {
      req.user = global.testUser;
    } else {
      req.user = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'USER',
        name: 'Test User',
        sessionId: 'test-session-id',
      };
    }
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Upload API Contract Tests', () => {
  let app: any;
  let testUser: any;
  let testWorkspace: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  beforeEach(async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    testUser = user;
    testWorkspace = workspace;
    (global as any).testUser = testUser;
  });

  describe('File Upload', () => {
    it('POST /upload should return success on valid file upload', async () => {
      // Using a file stream to ensure multer picks it up correctly
      const fs = await import('fs');
      const response = await request(app)
        .post('/api/v1/upload')
        .attach('file', fs.createReadStream(path.join(__dirname, 'test-file.txt')))
        .field('workspaceId', testWorkspace.id);

      if (response.status !== 200) {
        console.log('Upload response body:', response.body);
      }

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
