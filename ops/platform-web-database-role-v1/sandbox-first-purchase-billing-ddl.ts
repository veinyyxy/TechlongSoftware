import { SANDBOX_CHECKOUT_URL_MAX_BYTES, SANDBOX_CHECKOUT_URL_PATTERN } from "../../lib/purchases/sandbox-first-purchase-config.ts";

export const SANDBOX_BILLING_READ_SIGNATURE = "sandbox_first_purchase.read_billing_order(text,text)";

// Install as the existing sandbox_first_purchase owner in one transaction.
// Keep read_order (including the payment-result/API shape), attach and webhook
// unchanged. The Web role gets only EXECUTE on this one additional function.
export const SANDBOX_BILLING_READ_STATEMENTS = [
  `CREATE FUNCTION sandbox_first_purchase.read_billing_order(p_actor text, p_order text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog, public, pg_temp
AS $billing$
  WITH allowed AS MATERIALIZED (
    SELECT sandbox_first_purchase.read_order(p_actor, p_order) AS summary
  )
  SELECT allowed.summary || jsonb_build_object('checkoutUrl', (
    SELECT r.checkout_url
    FROM public.subscription_purchase_orders r
    JOIN public.payment_records p ON p.id=r.payment_record_id AND p.workspace_id=r.workspace_id
    WHERE r.id=p_order AND r.status='checkout_pending' AND r.expires_at>floor(extract(epoch FROM statement_timestamp())*1000)
      AND r.provider='stripe' AND r.created_by_user_id=p_actor
      AND r.provider_payment_id IS NULL AND r.subscription_id IS NULL AND r.completed_at IS NULL
      AND p.provider='stripe' AND p.status='pending' AND p.reference=r.provider_session_id
      AND p.subscription_id IS NULL AND p.paid_at IS NULL AND p.provider_payment_id IS NULL AND p.provider_event_id IS NULL
      AND p.amount=r.amount AND p.currency=r.currency
      AND r.provider_session_id ~ '^cs_test_[A-Za-z0-9]{1,200}$'
      AND octet_length(r.checkout_url)<=${SANDBOX_CHECKOUT_URL_MAX_BYTES}
      AND substring(r.checkout_url FROM '${SANDBOX_CHECKOUT_URL_PATTERN}')=r.provider_session_id
  ))
  FROM allowed WHERE allowed.summary ->> 'orderId'=p_order;
$billing$;`,
  `REVOKE ALL ON FUNCTION ${SANDBOX_BILLING_READ_SIGNATURE} FROM PUBLIC;`,
  `GRANT EXECUTE ON FUNCTION ${SANDBOX_BILLING_READ_SIGNATURE} TO techlong_platform_web_acceptance_v1;`,
] as const;
