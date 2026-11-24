import { getDatabase } from "@/db";
import { isFirstOpenAdmin, type FirstOpenAdminActor } from "./first-open-admin-http";
import { createFirstOpenAdminStore } from "./first-open-admin-store";

async function readForInstancesPage<T>(read: () => Promise<T>, unavailable: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    // Keep the existing instance pages available while the T2 schema and grants await installation.
    if (error && typeof error === "object" && "code" in error &&
      (error.code === "42P01" || error.code === "42501")) return unavailable;
    throw error;
  }
}

export function listFirstOpenAdminSummaries(actor: FirstOpenAdminActor, instanceIds: readonly string[]) {
  if (!isFirstOpenAdmin(actor) || !instanceIds.length) return Promise.resolve([]);
  return readForInstancesPage(() => createFirstOpenAdminStore(getDatabase()).listSummaries(instanceIds, actor.id), []);
}

export function readFirstOpenForAdmin(actor: FirstOpenAdminActor, instanceId: string) {
  if (!isFirstOpenAdmin(actor)) return Promise.resolve(null);
  return readForInstancesPage(() => createFirstOpenAdminStore(getDatabase()).read(instanceId, actor.id), null);
}
