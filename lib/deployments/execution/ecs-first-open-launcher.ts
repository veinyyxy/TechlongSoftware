import { isFirstOpenExecutionId } from "./ecs-first-open.ts";
import { dispatchEcsFirstOpen, type FirstOpenEcsPlacement } from "./ecs-first-open-dispatch.ts";

type LaunchDependencies = Parameters<typeof dispatchEcsFirstOpen>[2] & { placement: FirstOpenEcsPlacement };

/** Enforce the request shape at the boundary that holds the launch capability. */
export function createEcsFirstOpenLaunchHandler({ placement, store, ecs }: LaunchDependencies) {
  const fixedPlacement = {
    ...placement,
    subnetIds: [...placement.subnetIds],
    securityGroupIds: [...placement.securityGroupIds],
  };

  return async (input: unknown) => {
    if (input === null || typeof input !== "object") throw Error("ECS_FIRST_OPEN_LAUNCH_INPUT");
    const prototype = Object.getPrototypeOf(input);
    const id = Object.getOwnPropertyDescriptor(input, "executionId");
    if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(input).length !== 1 ||
      !id?.enumerable || typeof id.value !== "string" || !isFirstOpenExecutionId(id.value)) {
      throw Error("ECS_FIRST_OPEN_LAUNCH_INPUT");
    }
    return dispatchEcsFirstOpen(id.value, fixedPlacement, { store, ecs });
  };
}
