type D1Value = string | number | boolean | null | ArrayBuffer;

interface D1Result<T = unknown> {
  success?: boolean;
  results: T[];
  meta: {
    changes?: number;
    duration?: number;
    rows_read?: number;
    rows_written?: number;
  };
}

interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    DATABASE_URL?: string;
    PLATFORM_ADMIN_EMAILS?: string;
    [key: string]: unknown;
  };
}
