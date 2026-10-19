import { requirePlatformAdminApi } from '@/lib/auth/admin-api';
import { createControlHandlers } from '@/lib/deployments/controller-v6/http';
import { getPlatformControlStatus, actPlatformControl, platformControlEnabled } from '@/lib/deployments/controller-v6/runtime';
const handlers=createControlHandlers({authorize:requirePlatformAdminApi,status:getPlatformControlStatus,
  act:actPlatformControl,enabled:platformControlEnabled});
export const GET=handlers.GET;
export const POST=handlers.POST;
