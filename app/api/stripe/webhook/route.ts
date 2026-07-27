import { getStripeWebhookSecret, sha256Hex, verifyStripeWebhook } from "@/lib/payments/stripe";
import { processStripeWebhookEvent } from "@/lib/payments/management";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
