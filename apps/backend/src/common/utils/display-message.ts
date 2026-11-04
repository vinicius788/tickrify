/** Presentation metadata travels beside the original text; never used by the engine. */
export type DisplayMessage = {
  code: string;
  params: Record<string, string | number>;
  text: string;
};

export class DisplayError extends Error {
  constructor(readonly code: string, message: string, readonly params: Record<string, string | number> = {}) {
    super(message);
    this.name = 'DisplayError';
  }
}

export function imageErrorResponse(error: unknown) {
  return {
    code: error instanceof DisplayError ? error.code : 'image_invalid',
    params: error instanceof DisplayError ? error.params : {},
    message: error instanceof Error ? error.message : 'Invalid image payload',
  };
}

export function validationMessages(value: unknown): DisplayMessage[] | null {
  if (!value || typeof value !== 'object' || !('validationErrors' in value) || !Array.isArray(value.validationErrors)) return null;
  return value.validationErrors.filter((message): message is DisplayMessage =>
    !!message && typeof message === 'object' && typeof message.code === 'string' &&
    typeof message.text === 'string' && !!message.params && typeof message.params === 'object' &&
    Object.values(message.params).every(param => typeof param === 'string' || (typeof param === 'number' && Number.isFinite(param))),
  );
}
