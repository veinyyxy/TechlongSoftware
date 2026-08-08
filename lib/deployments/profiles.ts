export const deploymentProfileKeys = [
  "standard-v1",
  "large-v1",
  "large-dedicated-db-v1",
] as const;

export type DeploymentProfileKey = (typeof deploymentProfileKeys)[number];

export interface DeploymentProfile {
  key: DeploymentProfileKey;
  label: string;
  description: string;
  ecs: {
    cpu: number;
    memoryMiB: number;
    desiredCount: number;
  };
  autoScaling: {
    minCapacity: number;
    maxCapacity: number;
  };
  database: {
    isolation: "schema" | "dedicated_database";
  };
}

const profiles: Record<DeploymentProfileKey, DeploymentProfile> = {
  "standard-v1": {
    key: "standard-v1",
    label: "标准租户",
    description: "共享 Cell 数据库，单任务起步并独立扩缩容。",
    ecs: {
      cpu: 512,
      memoryMiB: 1024,
      desiredCount: 1,
    },
    autoScaling: { minCapacity: 1, maxCapacity: 4 },
    database: { isolation: "schema" },
  },
  "large-v1": {
    key: "large-v1",
    label: "大型租户",
    description: "共享 Cell 数据库，至少两个高规格任务并提高扩容上限。",
    ecs: {
      cpu: 1024,
      memoryMiB: 2048,
      desiredCount: 2,
    },
    autoScaling: { minCapacity: 2, maxCapacity: 12 },
    database: { isolation: "schema" },
  },
  "large-dedicated-db-v1": {
    key: "large-dedicated-db-v1",
    label: "大型租户（独立数据库）",
    description: "至少两个高规格任务，并为租户规划独立数据库。",
    ecs: {
      cpu: 2048,
      memoryMiB: 4096,
      desiredCount: 2,
    },
    autoScaling: { minCapacity: 2, maxCapacity: 20 },
    database: { isolation: "dedicated_database" },
  },
};

export const deploymentProfileOptions = deploymentProfileKeys.map((key) => ({
  ...profiles[key],
  ecs: { ...profiles[key].ecs },
  autoScaling: { ...profiles[key].autoScaling },
  database: { ...profiles[key].database },
}));

export function isDeploymentProfileKey(
  value: unknown,
): value is DeploymentProfileKey {
  return deploymentProfileKeys.includes(value as DeploymentProfileKey);
}

export function getDeploymentProfile(
  key: DeploymentProfileKey,
): DeploymentProfile {
  const profile = profiles[key];
  return {
    ...profile,
    ecs: { ...profile.ecs },
    autoScaling: { ...profile.autoScaling },
    database: { ...profile.database },
  };
}
