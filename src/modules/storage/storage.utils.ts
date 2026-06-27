export function toMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

const PLAN_FILE_SIZE_LIMITS: Record<string, number> = {
  FREE: 5,
  PRO: 25,
  BUSINESS: 100,
  ENTERPRISE: 500,
};

export function getMaxFileSizeForPlan(plan: string): number {
  return PLAN_FILE_SIZE_LIMITS[plan] ?? 5;
}

export function getCategoryFromMimeType(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "Images";
  if (mimeType.startsWith("video/")) return "Videos";
  if (mimeType.includes("pdf")) return "PDFs";
  if (mimeType.includes("sheet") || mimeType.includes("excel"))
    return "Spreadsheets";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
    return "Presentations";
  if (mimeType.includes("word") || mimeType.includes("document"))
    return "Documents";
  if (mimeType.includes("zip") || mimeType.includes("archive") || mimeType.includes("rar"))
    return "Archives";
  return "Other";
}
