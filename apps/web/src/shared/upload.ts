export const maxUploadBytes = 262_144_000;

export function validateDemo(file: Pick<File, 'name' | 'size'>): 'INVALID_DEMO' | 'SIZE_LIMIT' | null {
  if (!file.name.toLowerCase().endsWith('.dem') || file.size === 0) return 'INVALID_DEMO';
  if (file.size > maxUploadBytes) return 'SIZE_LIMIT';
  return null;
}
