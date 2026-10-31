// Mirrors the backend ceiling. This is only an upload hint; a smaller file may still be an invalid demo.
export const maxUploadBytes = 512 * 1024 * 1024;

export function validateDemo(file: Pick<File, 'name' | 'size'>): 'INVALID_DEMO' | 'SIZE_LIMIT' | null {
  if (!file.name.toLowerCase().endsWith('.dem') || file.size === 0) return 'INVALID_DEMO';
  if (file.size > maxUploadBytes) return 'SIZE_LIMIT';
  return null;
}
