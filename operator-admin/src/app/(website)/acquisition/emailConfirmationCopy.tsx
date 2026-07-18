/**
 * Shared "check your inbox" copy for the first successful submission
 * confirmation shown across Claim Your Venue and Add Your Venue. The paired
 * confirmation emails no longer repeat this reminder — this modal is now the
 * one place operators see it, right where they're already looking.
 */
export const CHECK_SPAM_REMINDER =
  "Don’t see it? Check your spam or junk folder, and add hello@happyhourcompass.com to your contacts so you don’t miss it.";

export function EmailConfirmationNote({ lead }: { lead: string }) {
  return (
    <p className="text-[13px] text-gray-500 leading-relaxed max-w-[290px]">
      {lead} {CHECK_SPAM_REMINDER}
    </p>
  );
}
