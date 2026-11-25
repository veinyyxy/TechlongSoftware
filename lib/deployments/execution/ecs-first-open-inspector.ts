import type { SaaSControlObservation } from "./contracts.ts";
import { verifyFirstOnboardingRuntime } from "./first-onboarding-inspection.ts";
import { assertFirstOpenRdsTaskDefinition, type FirstOpenRdsWorkload } from "./single-tenant-workload-strategy.ts";

type EcsFirstOpenInspection = Omit<Parameters<typeof verifyFirstOnboardingRuntime>[0], "completion"> & {
  rdsWorkload?: FirstOpenRdsWorkload;
  readConfiguration(signal: AbortSignal): Promise<SaaSControlObservation>;
};

/** Technical self-check in the opening task, using a fresh read of its target. */
export async function inspectEcsFirstOpen(input: EcsFirstOpenInspection) {
  const { readConfiguration, rdsWorkload, ...inspection } = input;
  const { artifactRef, configurationHash } = inspection.context.deployment;
  const imageRevision = artifactRef.split("@").at(-1);
  if (!/^[a-f0-9]{64}$/.test(configurationHash) || !imageRevision || !/^sha256:[a-f0-9]{64}$/.test(imageRevision)) {
    throw new Error("ECS_FIRST_OPEN_CONFIGURATION_EXPECTATION_INVALID");
  }

  if ((inspection.databaseProfile === "full_password") !== Boolean(rdsWorkload)) {
    throw Error("ECS_FIRST_OPEN_RDS_WORKLOAD_READBACK_MISMATCH");
  }
  const reader = rdsWorkload ? { async capture(target: Parameters<typeof inspection.reader.capture>[0]) {
    const sample = await inspection.reader.capture(target);
    assertFirstOpenRdsTaskDefinition(rdsWorkload, sample.facts.taskDefinition);
    return sample;
  } } : inspection.reader;
  const { runtime } = await verifyFirstOnboardingRuntime({ ...inspection, reader, completion: undefined });
  inspection.signal.throwIfAborted();
  const configuration = await readConfiguration(inspection.signal);
  inspection.signal.throwIfAborted();
  if (configuration.ready !== true || configuration.desiredConfigurationHash !== configurationHash || configuration.imageRevision !== imageRevision) {
    throw new Error("ECS_FIRST_OPEN_CONFIGURATION_MISMATCH");
  }
  return runtime;
}
