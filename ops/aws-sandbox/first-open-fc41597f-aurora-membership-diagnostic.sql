-- Diagnostic only. Run once over verified TLS on the original Sandbox Express
-- writer, database postgres, using the existing postgres DBA login.
-- Return one row of counts/booleans; do not modify, grant, or repeat installation.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';

WITH target AS MATERIALIZED (
  SELECT coalesce(current_database() = 'postgres'
    AND current_user = 'postgres' AND session_user = 'postgres'
    AND current_setting('transaction_read_only') = 'on'
    AND current_setting('server_version_num')::integer = 170009
    AND NOT pg_is_in_recovery()
    AND EXISTS (SELECT 1 FROM pg_database WHERE oid = 5 AND datname = 'postgres' AND datdba = 16410 AND datallowconn),
    false) AS matched
), ids AS MATERIALIZED (
  SELECT (SELECT oid FROM pg_roles WHERE rolname = 'postgres') AS dba,
         (SELECT oid FROM pg_roles WHERE rolname = 'rds_iam' AND oid = 16389) AS iam,
         (SELECT oid FROM pg_roles WHERE rolname = 'sf_fc41597f_lifecycle') AS lifecycle,
         (SELECT oid FROM pg_roles WHERE rolname = 'sf_fc41597f_lifecycle_definer') AS definer,
         (SELECT oid FROM pg_roles WHERE rolname = 'tenant_e9fdccd5d8c7685c_inspect') AS inspector
  FROM target WHERE matched
), scoped AS MATERIALIZED (
  SELECT * FROM ids
  WHERE dba IS NOT NULL AND iam IS NOT NULL AND lifecycle IS NOT NULL AND definer IS NOT NULL AND inspector IS NOT NULL
), outgoing AS (
  SELECT v.label, count(m.roleid) AS total,
         count(m.roleid) FILTER (WHERE m.roleid = s.iam AND m.admin_option = v.expected_admin
                                 AND NOT m.inherit_option AND NOT m.set_option) AS matches
  FROM scoped s
  CROSS JOIN LATERAL (VALUES ('lifecycle', s.lifecycle, false), ('definer', s.definer, true),
                            ('inspector', s.inspector, false)) v(label, member_id, expected_admin)
  LEFT JOIN pg_auth_members m ON m.member = v.member_id
  GROUP BY v.label
), definer_incoming AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE m.member <> s.dba OR NOT m.admin_option OR m.inherit_option OR m.set_option) AS unexpected,
         count(*) FILTER (WHERE m.member = s.dba AND m.grantor = s.dba AND NOT m.admin_option
                          AND NOT m.inherit_option AND NOT m.set_option) AS dba_self_grant_no_options,
         count(*) FILTER (WHERE m.member = s.dba AND (m.inherit_option OR m.set_option)) AS dba_inherit_or_set,
         count(*) FILTER (WHERE m.member <> s.dba) AS non_dba
  FROM scoped s JOIN pg_auth_members m ON m.roleid = s.definer
)
SELECT jsonb_build_object(
  'jobId', 'job_fc41597f9b5ba8e02b338ecf',
  'targetMatched', (SELECT matched FROM target),
  'roleIdsMatched', EXISTS (SELECT 1 FROM scoped),
  'rdsIamExact', CASE WHEN EXISTS (SELECT 1 FROM scoped)
                  THEN (SELECT count(*) = 3 AND bool_and(total = 1 AND matches = 1) FROM outgoing) END,
  'rdsIamCounts', (SELECT jsonb_object_agg(label, jsonb_build_object('total', total, 'matches', matches)) FROM outgoing),
  'definerInboundExact', CASE WHEN EXISTS (SELECT 1 FROM scoped) THEN i.unexpected = 0 END,
  'definerInboundCounts', CASE WHEN EXISTS (SELECT 1 FROM scoped)
                           THEN jsonb_build_object('total', i.total, 'unexpected', i.unexpected,
                             'dbaSelfGrantNoOptions', i.dba_self_grant_no_options,
                             'dbaInheritOrSet', i.dba_inherit_or_set, 'nonDba', i.non_dba) END
) AS first_open_membership_diagnostic
FROM definer_incoming i;

COMMIT;
