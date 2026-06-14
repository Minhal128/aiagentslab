const isProduction = () => process.env.NODE_ENV === 'production';

export function safeErrorMessage(error: any, fallback: string = 'Internal server error'): string {
  if (!isProduction()) {
    return error?.message || fallback;
  }
  return fallback;
}
