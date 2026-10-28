export const MAX_CHART_BYTES = 10 * 1024 * 1024;
export const CHART_ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

export function chartFileError(file: File): 'uploadFormat' | 'uploadSize' | null {
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type.toLowerCase())) return 'uploadFormat';
  return file.size > MAX_CHART_BYTES ? 'uploadSize' : null;
}
