-- UNINSTALLED, separately approved permission candidate. No roles, LOGIN,
-- passwords or Secret changes. Not part of the schema candidate itself.
GRANT SELECT ON public.deployment_failed_cell_birth_fences_v1 TO techlong_cell_cleanup_reader;
GRANT SELECT(id,deployment_id,status) ON public.deployment_jobs,public.deployment_step_runs TO techlong_cell_cleanup_reader;
GRANT EXECUTE ON FUNCTION public.begin_failed_cell_birth_fence_v1(text,text) TO techlong_cell_drain;
-- No INSERT/UPDATE/DELETE/TRUNCATE grants on the permanent fence; the fixed
-- SECURITY DEFINER entry has an exact environment lock and zero predicates.
