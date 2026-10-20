import { requirePlatformAdminApi } from '@/lib/auth/admin-api';
import { createInitializedPlatformHandlers } from '@/lib/deployments/initialized-platform-http';
import { getInitializedPlatformStatus, submitInitializedPlatformRequest, initializedPlatformRequestGateEnabled, initializedPlatformRequestOrigin } from '@/lib/deployments/initialized-platform-management';

const handlers = createInitializedPlatformHandlers({ authorize: requirePlatformAdminApi,
  enabled: initializedPlatformRequestGateEnabled,origin:initializedPlatformRequestOrigin, read: getInitializedPlatformStatus, submit: submitInitializedPlatformRequest });
export const GET = handlers.GET;
export const POST = handlers.POST;
