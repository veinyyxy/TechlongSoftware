type DatabaseValue = string | number | boolean | null | ArrayBuffer;

interface DatabaseResult<T = unknown> {
  success?: boolean;
  results: T[];
  meta: {
    changes?: number;
    duration?: number;
    rows_read?: number;
    rows_written?: number;
  };
}

interface DatabasePreparedStatement {
  bind(...values: DatabaseValue[]): DatabasePreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<DatabaseResult<T>>;
  run(): Promise<DatabaseResult>;
}

interface ApplicationDatabase {
  prepare(query: string): DatabasePreparedStatement;
  batch<T = unknown>(
    statements: DatabasePreparedStatement[],
  ): Promise<DatabaseResult<T>[]>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: ApplicationDatabase;
    DATABASE_URL?: string;
    PLATFORM_ADMIN_EMAILS?: string;
    [key: string]: unknown;
  };
}
