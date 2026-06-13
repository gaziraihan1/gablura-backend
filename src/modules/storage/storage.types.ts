
export interface StorageInfo {
  usedMB: number;
  totalMB: number;
  remainingMB: number;
  percentage: number;
  plan: string;
  workspaceId: string;
  workspaceName: string;
}

export interface UserStorageContribution {
  userId: string;
  userName: string | null;
  userEmail: string;
  usageMB: number;
  fileCount: number;
  percentage: number;
}

export interface StorageBreakdown {
  attachments: number;
  workspaceFiles: number;
  projectFiles: number;
  total: number;
}

export interface LargestFile {
  id: string;
  name: string;
  originalName: string;
  size: number;
  sizeMB: number;
  mimeType: string;
  url: string;
  uploadedAt: Date;
  uploadedBy: { id: string; name: string | null; email: string };
  task:    { id: string; title: string } | null;
  project: { id: string; name: string  } | null;
}

export interface StorageTrend {
  date: Date;
  usageMB: number;
}

export interface FileTypeBreakdown {
  mimeType:  string;
  category:  string;
  count:     number;
  sizeMB:    number;
}

export interface WorkspaceSummary {
  workspaceId:    string;
  workspaceName:  string;
  plan:           string;
  usageMB:        number;
  totalMB:        number;
  remainingMB:    number;
  percentage:     number;
  role:           string;
  fileCount:      number;
}

export interface MyContribution {
  usageMB:    number;
  fileCount:  number;
  percentage: number;
}

export interface BulkDeleteResult {
  deletedCount: number;
  freedMB:      number;
}

export interface UploadCheckResult {
  allowed: boolean;
  reason?: string;
}