import escapeHtml from 'escape-html';
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre'
];

const ALLOWED_ATTRIBUTES = {
  'a': ['href', 'title', 'target'],
  'img': ['src', 'alt', 'title', 'width', 'height'],
};

export function sanitizePlainText(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  return escapeHtml(input.trim())
    .substring(0, 10000); // Max length protection
}

export function sanitizeRichText(html: string): string {
  if (!html || typeof html !== 'string') return '';

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre'
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'src', 'alt'],
    ALLOW_DATA_ATTR: false,
  });

  return clean.substring(0, 50000);
}

export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') return 'file.txt';

  let sanitized = filename.replace(/\.\./g, '');
  
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  if (!sanitized.includes('.')) {
    sanitized += '.txt';
  }

  return sanitized.substring(0, 255) || 'file.txt';
}

export function sanitizeUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';

  const trimmed = url.trim();
  
  if (!trimmed.match(/^https?:\/\//i)) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    
    const dangerousDomains = ['javascript', 'data', 'vbscript'];
    if (dangerousDomains.includes(parsed.protocol.replace(':', ''))) {
      return '';
    }

    const href = parsed.href;
    return href.endsWith('/') && parsed.pathname === '/' 
      ? href.slice(0, -1) 
      : href;
  } catch {
    return '';
  }
}

export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj as any;

  if (Array.isArray(obj)) {
    return obj.map(item => (typeof item === 'object' ? sanitizeObject(item) : (typeof item === 'string' ? sanitizePlainText(item) : item))) as any;
  }

  const sanitized: any = {};

  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = sanitizePlainText(key);
    
    if (typeof value === 'string') {
      sanitized[sanitizedKey] = sanitizePlainText(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[sanitizedKey] = sanitizeObject(value);
    } else {
      sanitized[sanitizedKey] = value;
    }
  }

  return sanitized as T;
}