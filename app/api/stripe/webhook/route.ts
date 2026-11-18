import { getStripeWebhookSecret, sha256Hex, verifyStripeWebhook } from "@/lib/payments/stripe";
import { processStripeWebhookEvent } from "@/lib/payments/management";
import { sandboxFirstPurchaseSelected, sandboxPurchaseWebhook } from "@/lib/purchases/sandbox-first-purchase-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (sandboxFirstPurchaseSelected()) {
    try {
      const outcome = await sandboxPurchaseWebhook(await request.text(), request.headers.get("stripe-signature"));
      return outcome === null
        ? Response.json({ received: false }, { status: 503 })
        : Response.json({ received: true, outcome });
    } catch {
      return Response.json({ received: false, error: "Sandbox webhook not processed." }, { status: 400 });
    }
  }
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    return Response.json({ received: false, error: "Webhook is not configured." }, { status: 503 });
  }

  const payload = await request.text();
  let event;
  try {
    event = await verifyStripeWebhook(
      payload,
      request.headers.get("stripe-signature"),
      webhookSecret,
    );
  } catch {
    return Response.json({ received: false, error: "Invalid webhook signature." }, { status: 400 });
  }

  try {
    const result = await processStripeWebhookEvent({
      event,
      payloadHash: await sha256Hex(payload),
    });
    return Response.json({ received: true, ...result });
  } catch {
    return Response.json({ received: false, error: "Webhook processing failed." }, { status: 500 });
  }
}
