import type { IconName } from '@huddle/ui';

export interface FileLook {
  icon: IconName;
  label: string;
  /** A tint, not a brand colour. It groups a list at a glance and nothing more. */
  tone: string;
}

const BY_EXTENSION: Record<string, FileLook> = {
  pdf: { icon: 'file', label: 'PDF', tone: 'text-critical bg-critical/10' },
  doc: { icon: 'file', label: 'Document', tone: 'text-accent bg-accent-soft' },
  docx: { icon: 'file', label: 'Document', tone: 'text-accent bg-accent-soft' },
  txt: { icon: 'file', label: 'Text', tone: 'text-text-secondary bg-surface-sunken' },
  md: { icon: 'file', label: 'Markdown', tone: 'text-text-secondary bg-surface-sunken' },
  csv: { icon: 'file', label: 'Spreadsheet', tone: 'text-positive bg-positive/10' },
  xls: { icon: 'file', label: 'Spreadsheet', tone: 'text-positive bg-positive/10' },
  xlsx: { icon: 'file', label: 'Spreadsheet', tone: 'text-positive bg-positive/10' },
  zip: { icon: 'file', label: 'Archive', tone: 'text-caution bg-caution/10' },
  gz: { icon: 'file', label: 'Archive', tone: 'text-caution bg-caution/10' },
  tar: { icon: 'file', label: 'Archive', tone: 'text-caution bg-caution/10' },
};

const CODE = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'py',
  'rs',
  'go',
  'rb',
  'java',
  'sql',
  'sh',
  'yml',
  'yaml',
  'html',
  'css',
  'toml',
]);

/**
 * What a file should look like in a list. Extension first, because a browser
 * hands over `application/octet-stream` often enough that the type alone would
 * make half of everything look identical.
 */
export function lookOf(name: string, mimeType: string): FileLook {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';

  const known = BY_EXTENSION[extension];
  if (known) return known;

  if (CODE.has(extension)) {
    return { icon: 'file', label: extension.toUpperCase(), tone: 'text-accent bg-accent-soft' };
  }

  if (mimeType.startsWith('audio/')) {
    return { icon: 'mic', label: 'Audio', tone: 'text-accent bg-accent-soft' };
  }

  if (mimeType.startsWith('video/')) {
    return { icon: 'image', label: 'Video', tone: 'text-accent bg-accent-soft' };
  }

  return {
    icon: 'file',
    label: extension === '' ? 'File' : extension.toUpperCase(),
    tone: 'text-text-secondary bg-surface-sunken',
  };
}
