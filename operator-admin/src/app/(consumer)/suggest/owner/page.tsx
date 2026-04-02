import { OwnerSubmissionFlow } from "./OwnerSubmissionFlow";

export const metadata = { title: "List Your Venue" };

/**
 * Operator submission page — Phase 3A.
 *
 * Collects business + contact details, performs a backend Google Places
 * lookup, and presents a single best-match confirmation screen.
 * The submitter confirms or rejects the match; the submission is then
 * persisted to operator_submissions for internal review.
 *
 * No venue is created, no operator account is provisioned, and no email
 * notification is sent in this phase.
 */
export default function OwnerSubmissionPage() {
  return (
    <main className="bg-white min-h-full">
      <OwnerSubmissionFlow />
    </main>
  );
}
