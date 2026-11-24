import type { SaaSControlObservation } from "./contracts.ts";
import { verifyFirstOnboardingRuntime } from "./first-onboarding-inspection.ts";

type EcsFirstOpenInspection = Omit<Parameters<typeof verifyFirstOnboardingRuntime>[0], "completion"> & {
  readConfiguration(signal: AbortSignal): Promise<SaaSControlObservation>;
};

/** Technical self-check in the opening task, using a fresh read of its target. */
export async function inspectEcsFirstOpen(input: EcsFirstOpenInspection) {
  const { readConfiguration, ...inspection } = input;
  const { artifactRef, configurationHash } = inspection.context.deployment;
  const imageRevision = artifactRef.split("@").at(-1);
  if (!/^[a-f0-9]{64}$/.test(configurationHash) || !imageRevision || !/^sha256:[a-f0-9]{64}$/.test(imageRevision)) {
    throw new Error("ECS_FIRST_OPEN_CONFIGURATION_EXPECTATION_INVALID");
  }

  const { runtime } = await verifyFirstOnboardingRuntime({ ...inspection, completion: undefined });
  inspection.signal.throwIfAborted();
  const configuration = await readConfiguration(inspection.signal);
  inspection.signal.throwIfAborted();
  if (configuration.ready !== true || configuration.desiredConfigurationHash !== configurationHash || configuration.imageRevision !== imageRevision) {
    throw new Error("ECS_FIRST_OPEN_CONFIGURATION_MISMATCH");
  }
  return runtime;
}
