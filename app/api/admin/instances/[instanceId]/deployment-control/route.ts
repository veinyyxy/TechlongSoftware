import { requirePlatformAdminApi } from '@/lib/auth/admin-api';
import { createControlHandlers } from '@/lib/deployments/controller-v6/http';
import { getPlatformControlStatus, actPlatformControl, platformControlEnabled, platformControlOrigin } from '@/lib/deployments/controller-v6/runtime';
const handlers=createControlHandlers({authorize:requirePlatformAdminApi,status:getPlatformControlStatus,
  act:actPlatformControl,enabled:platformControlEnabled,origin:platformControlOrigin});
export const GET=handlers.GET;
export const POST=handlers.POST;
