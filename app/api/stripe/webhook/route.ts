import { getStripeWebhookSecret, sha256Hex, verifyStripeWebhook, type StripeWebhookEvent } from "@/lib/payments/stripe";
import { processStripeWebhookEvent } from "@/lib/payments/management";
import { sandboxFirstPurchaseSelected, sandboxPurchaseWebhook } from "@/lib/purchases/sandbox-first-purchase-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const firstPurchase = sandboxFirstPurchaseSelected();
  const webhookSecret = getStripeWebhookSecret();
  if (!firstPurchase && !webhookSecret) {
    return Response.json({ received: false, error: "Webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();
  let event: StripeWebhookEvent;
  if (firstPurchase) {
    try {
      const delivery = await sandboxPurchaseWebhook(payload, signature, webhookSecret);
      if (delivery === null) return Response.json({ received: false }, { status: 503 });
      if (delivery.kind === "invalid") return Response.json({ received: false, error: "Invalid webhook signature." }, { status: 400 });
      if (delivery.kind === "ignored") return Response.json({ received: true, outcome: "ignored" });
      if (delivery.kind === "first-purchase") return Response.json({ received: true, outcome: delivery.outcome });
      event = delivery.event;
    } catch {
      return Response.json({ received: false, error: "Sandbox webhook not processed." }, { status: 400 });
    }
  } else {
    try {
      event = await verifyStripeWebhook(payload, signature, webhookSecret!);
    } catch {
      return Response.json({ received: false, error: "Invalid webhook signature." }, { status: 400 });
    }
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
