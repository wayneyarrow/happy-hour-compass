// Boundary fake for the "resend" package: the email provider.
import { world } from "../world";

export class Resend {
  emails = {
    async send(
      payload: { from?: string; to: string; subject: string; html: string; text: string },
      opts?: { idempotencyKey?: string }
    ) {
      if (world.emailSendFails) return { data: null, error: { message: "fake provider rejected the message" } };
      world.emails.push({ ...payload, idempotencyKey: opts?.idempotencyKey });
      return { data: { id: `fake-email-${world.emails.length}` }, error: null };
    },
  };
}
