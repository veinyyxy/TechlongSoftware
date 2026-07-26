export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}

export type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiError };

export function apiSuccess<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export function apiError(
  code: string,
  message: string,
  fields?: Record<string, string[]>,
): ApiResponse<never> {
  return {
    success: false,
    data: null,
    error: fields ? { code, message, fields } : { code, message },
  };
}
