import { apiError, apiSuccess } from "@/lib/api/response";
import { managementErrorResponse } from "@/lib/admin/http";
import { requirePlatformAdminApi } from "@/lib/auth/admin-api";
import { getD1 } from "@/db";
import {
  inspectDatabaseMigration,
  migrateD1ToPostgres,
} from "@/lib/database/migrate-to-postgres";

const CONFIRMATION = "MIGRATE_D1_TO_NEON";

export async function GET(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  if (url.searchParams.get("format") === "json") {
    try {
      return Response.json(
        apiSuccess({ tables: await inspectDatabaseMigration(getD1()) }),
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return managementErrorResponse(error);
    }
  }

  return new Response(
    `<!doctype html>
     <html lang="zh-CN">
       <head><meta charset="utf-8"><title>D1 迁移到 Neon</title></head>
       <body style="font-family:sans-serif;max-width:760px;margin:48px auto">
         <h1>D1 迁移到 Neon PostgreSQL</h1>
         <p>将当前 Sites D1 的 14 张业务表复制到已初始化的 Neon 数据库，并逐表核对记录数量。</p>
         <p>D1 不会被删除，仍保留作为回滚备份。</p>
         <form method="post">
           <input type="hidden" name="confirmation" value="${CONFIRMATION}">
           <button type="submit">开始迁移并校验</button>
         </form>
       </body>
     </html>`,
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdminApi();
  if (authorization.response) return authorization.response;

  try {
    const formData = await request.formData();
    if (String(formData.get("confirmation") ?? "") !== CONFIRMATION) {
      return Response.json(
        apiError("CONFIRMATION_REQUIRED", "数据库迁移确认信息不正确。"),
        { status: 400 },
      );
    }
    const tables = await migrateD1ToPostgres(getD1());
    return Response.json(apiSuccess({ migrated: true, tables }), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return managementErrorResponse(error);
  }
}
