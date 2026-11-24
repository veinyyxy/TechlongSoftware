// Both the admin and customer instance readers use this PostgreSQL projection.
// Raw activation fields can be committed while the readback is still uncertain.
export const firstOpenVisibilityJoins = `
  LEFT JOIN public.first_open_executions first_open ON first_open.instance_id = ai.id
  LEFT JOIN app_instance_deployments first_open_deployment ON first_open_deployment.id = first_open.deployment_id
    AND first_open_deployment.app_instance_id = ai.id
  LEFT JOIN deployment_jobs first_open_job ON first_open_job.id = first_open.job_id
    AND first_open_job.deployment_id = first_open_deployment.id
  LEFT JOIN LATERAL (
    SELECT step, status FROM public.first_open_execution_events
    WHERE execution_id = first_open.id ORDER BY sequence DESC LIMIT 1
  ) first_open_progress ON true`;

const waitingForReadback = `first_open.id IS NOT NULL AND (
  first_open_progress.step = 'activation' AND first_open_progress.status = 'completed'
  AND first_open_deployment.status = 'ready' AND first_open_job.status = 'succeeded'
) IS NOT TRUE`;

export const visibleFirstOpenStatus = `CASE
  WHEN ${waitingForReadback} AND ai.status IN ('pending', 'active') THEN
    CASE WHEN first_open_progress.status = 'failed' THEN 'failed' ELSE 'pending' END
  ELSE ai.status END`;

export const visibleFirstOpenAccessUrl = `CASE WHEN ${waitingForReadback} THEN '' ELSE ai.access_url END`;
export const visibleFirstOpenProvisionedAt = `CASE WHEN ${waitingForReadback} THEN NULL ELSE ai.provisioned_at END`;

export async function withFirstOpenVisibility<T>(read: (enabled: boolean) => Promise<T>): Promise<T> {
  try {
    return await read(true);
  } catch (error) {
    // Pre-approval schemas have no activation records. Other database errors must fail closed.
    if (!(error instanceof Error) || !("code" in error) || error.code !== "42P01" ||
      !error.message.includes('relation "public.first_open_executions" does not exist')) throw error;
    return read(false);
  }
}
