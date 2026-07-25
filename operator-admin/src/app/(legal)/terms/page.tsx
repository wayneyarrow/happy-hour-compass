import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Terms of Service",
  description: "Terms of Service for Happy Hour Compass, operated by Yellow Lab Software.",
  path: "/terms",
});

const EFFECTIVE_DATE = "June 19, 2026";
const LAST_UPDATED   = "July 25, 2026";

export default function TermsOfServicePage() {
  return (
    <article className="prose prose-sm prose-slate max-w-none">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Terms of Service</h1>
        <p className="text-sm text-gray-500">
          Happy Hour Compass, operated by Yellow Lab Software
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
          <span>Effective Date: {EFFECTIVE_DATE}</span>
          <span>Last Updated: {LAST_UPDATED}</span>
        </div>
      </div>

      <Section id="introduction" title="1. Introduction">
        <p>
          Welcome to Happy Hour Compass. These Terms of Service (&ldquo;Terms&rdquo;) govern your access
          to and use of the Happy Hour Compass website and services (collectively, the
          &ldquo;Service&rdquo;), operated by Yellow Lab Software (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), a company
          incorporated in British Columbia, Canada.
        </p>
        <p>
          Please read these Terms carefully before using the Service. By accessing or using
          the Service, you agree to be bound by these Terms. If you do not agree, please do
          not use the Service.
        </p>
      </Section>

      <Section id="acceptance" title="2. Acceptance of Terms">
        <p>
          By creating an account, submitting a venue claim, using the Service as a consumer,
          or otherwise accessing any part of the Service, you confirm that you have read,
          understood, and agree to be bound by these Terms, as well as our{" "}
          <Link href="/privacy">Privacy Policy</Link>, which is incorporated by reference.
        </p>
        <p>
          We may update these Terms from time to time. We will notify you of material changes
          by updating the &ldquo;Last Updated&rdquo; date and, where appropriate, providing notice within
          the Service or by email. Your continued use of the Service after changes constitutes
          acceptance of the updated Terms.
        </p>
      </Section>

      <Section id="eligibility" title="3. Eligibility">
        <p>
          You must be at least 18 years of age to use the Service. Happy Hour Compass is a
          platform related to bars, restaurants, and establishments that serve alcohol. By
          using the Service, you represent that you are at least 18 years old (or the legal
          drinking age in your jurisdiction, whichever is higher) and that you have the legal
          capacity to enter into a binding agreement.
        </p>
        <p>
          If you are using the Service on behalf of a business entity, you represent that you
          have authority to bind that entity to these Terms.
        </p>
      </Section>

      <Section id="consumer-use" title="4. Consumer Use of the Service">
        <p>
          Happy Hour Compass provides consumers with a free service to discover happy hours,
          restaurant and bar listings, events, and related information. No account is required
          to browse the Service as a consumer.
        </p>
        <p>
          <strong>Accuracy of venue information:</strong> Venue information displayed on Happy
          Hour Compass, including happy hour times, menus, prices, and hours of operation,
          is provided by venue operators or sourced from publicly available data. This information
          may not always be current, complete, or accurate. <strong>You should verify venue
          information directly with the venue before visiting.</strong> We are not responsible
          for any loss or inconvenience resulting from reliance on information displayed on
          the Service.
        </p>
        <p>
          Consumers may optionally create a free account to save venues, events, and guides,
          and to personalize their use of the Service. Creating a consumer account is subject
          to these Terms and our Privacy Policy. Future versions of the Service may offer
          personalized recommendations and other additional features, which will be subject
          to these Terms and any additional terms presented at the time of introduction.
        </p>
      </Section>

      <Section id="operator-accounts" title="5. Operator Accounts">
        <Subsection title="5.1 Account Registration">
          <p>
            To access the Operator Admin portal and manage your venue listing, you must create
            an account. You agree to provide accurate, current, and complete information during
            registration and to keep your account information up to date.
          </p>
          <p>
            You are responsible for maintaining the security of your account credentials and
            for all activities that occur under your account. You must notify us immediately
            at{" "}
            <a href="mailto:support@happyhourcompass.com">support@happyhourcompass.com</a> if
            you suspect unauthorized access to your account.
          </p>
        </Subsection>

        <Subsection title="5.2 Operator Responsibilities">
          <p>As a venue operator, you agree to:</p>
          <ul>
            <li>Provide accurate and truthful venue information, including business details,
              happy hour times, menus, and contact information.</li>
            <li>Keep your venue listing up to date, including any changes to hours, pricing,
              or status.</li>
            <li>Ensure that all content you upload or submit (including images and descriptions)
              does not infringe any third-party rights, including copyright and trademark.</li>
            <li>Not impersonate any other business or individual.</li>
            <li>Not use the Service to engage in fraudulent, deceptive, or illegal activity.</li>
          </ul>
        </Subsection>

        <Subsection title="5.3 Beta Constraints">
          <p>
            During the current beta phase, each operator account is limited to one venue
            listing. Multi-venue management capabilities may be introduced in future versions
            of the platform.
          </p>
        </Subsection>

        <Subsection title="5.4 Team Members">
          <p>
            Operators on eligible plans may invite team members to access their venue&rsquo;s
            Operator Admin. You are responsible for ensuring that your team members comply
            with these Terms. You may manage team access through your account settings.
          </p>
        </Subsection>
      </Section>

      <Section id="venue-claims" title="6. Venue Claims and Venue Submissions">
        <Subsection title="6.1 Venue Claims">
          <p>
            If you submit a claim to manage an existing venue listing, you represent that
            you are authorized to manage that venue on behalf of the business. You must
            provide accurate information including your name, email, phone number, and
            your role at the venue.
          </p>
          <p>
            Claim submissions are reviewed by the Happy Hour Compass team. We reserve the
            right to approve, reject, or request additional information for any claim at
            our sole discretion. Unauthorized venue claims — including claims made without
            proper authorization or with false information — may result in account suspension
            or claim revocation.
          </p>
          <p>
            Submitting a claim does not guarantee access to the venue&rsquo;s listing. Access is
            granted only upon approval by Happy Hour Compass.
          </p>
        </Subsection>

        <Subsection title="6.2 Venue Submissions">
          <p>
            Business owners may submit their venue for inclusion on Happy Hour Compass.
            Submissions are reviewed by our team and we reserve the right to accept, reject,
            or request additional information at our discretion.
          </p>
          <p>
            By submitting a venue, you grant Happy Hour Compass a non-exclusive, royalty-free
            licence to display the submitted information on the platform.
          </p>
        </Subsection>
      </Section>

      <Section id="user-responsibilities" title="7. User Responsibilities">
        <p>By using the Service, you agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose or in violation of applicable law.</li>
          <li>Scrape, crawl, or systematically extract data from the Service without our
            prior written consent.</li>
          <li>Attempt to gain unauthorized access to any part of the Service or its
            underlying infrastructure.</li>
          <li>Interfere with or disrupt the integrity or performance of the Service.</li>
          <li>Submit false, misleading, or fraudulent information.</li>
          <li>Use the Service to send unsolicited communications (spam).</li>
          <li>Reproduce, modify, distribute, or create derivative works of our content
            without permission.</li>
          <li>Use automated tools, bots, or scripts to access or interact with the Service,
            except as explicitly authorized by us.</li>
        </ul>
      </Section>

      <Section id="paid-plans" title="8. Paid Plans and Subscriptions">
        <p>
          Happy Hour Compass offers paid operator plans that provide enhanced features and
          visibility for venue listings. By subscribing to a paid plan, you agree to the
          pricing, features, and terms presented at the time of subscription.
        </p>
        <p>
          Plan features and pricing may change over time. We will provide reasonable notice
          of material changes to pricing or plan features.
        </p>
        <p>
          Subscriptions are managed through your Operator Admin portal. Access to paid plan
          features is contingent on maintaining an active subscription and an active venue
          account in good standing.
        </p>
      </Section>

      <Section id="billing" title="9. Billing and Payments">
        <p>
          Payments for paid operator plans are processed by Stripe, our third-party payment
          processor. By subscribing to a paid plan, you authorize us (via Stripe) to charge
          your payment method on a recurring monthly basis.
        </p>
        <p>
          All fees are displayed in Canadian dollars (CAD) unless otherwise stated. You are
          responsible for any applicable taxes associated with your subscription.
        </p>
        <p>
          If a payment fails, we may suspend access to paid features until the outstanding
          balance is resolved. We will attempt to notify you of any payment failure.
        </p>
      </Section>

      <Section id="cancellation" title="10. Cancellation">
        <Subsection title="10.1 Subscription Cancellation">
          <p>
            You may cancel your paid subscription at any time through your Operator Admin
            portal. <strong>Upon cancellation, your subscription access will continue until
            the end of your current billing cycle.</strong> You will not be charged for
            subsequent billing cycles after cancellation takes effect.
          </p>
          <p>
            Cancelling your subscription does not delete your venue account or data. Your
            venue listing will continue on the Free plan (if available) unless you also
            cancel your venue account.
          </p>
        </Subsection>

        <Subsection title="10.2 Venue Account Cancellation">
          <p>
            You may cancel your venue account through the Operator Admin portal. Upon
            cancellation:
          </p>
          <ul>
            <li>Your venue listing will be unpublished and removed from public discovery.</li>
            <li>Any active paid subscription will be downgraded to the Free plan.</li>
            <li>Your historical data, claim history, and analytics are preserved.</li>
            <li>The venue remains eligible for future reactivation by contacting us.</li>
          </ul>
          <p>
            Cancellation does not delete your data. If you wish to delete your personal
            information, please contact us at{" "}
            <a href="mailto:support@happyhourcompass.com">support@happyhourcompass.com</a>.
          </p>
        </Subsection>
      </Section>

      <Section id="refunds" title="11. Refunds">
        <p>
          <strong>All fees paid for Happy Hour Compass subscriptions are non-refundable,
          except where required by applicable law.</strong> This includes fees paid for
          partial billing periods.
        </p>
        <p>
          If you believe you have been charged in error, please contact us promptly at{" "}
          <a href="mailto:support@happyhourcompass.com">support@happyhourcompass.com</a>{" "}
          and we will review your request.
        </p>
        <p>
          Consumers in certain jurisdictions may have statutory rights to refunds or
          cancellation periods. Nothing in these Terms limits rights you may have under
          applicable consumer protection legislation.
        </p>
      </Section>

      <Section id="content-ownership" title="12. Content Ownership">
        <Subsection title="12.1 Your Content">
          <p>
            You retain ownership of any content you submit to the Service, including venue
            descriptions, images, happy hour details, and other business information
            (&ldquo;Your Content&rdquo;).
          </p>
          <p>
            By submitting content to the Service, you grant Happy Hour Compass a non-exclusive,
            worldwide, royalty-free, sublicensable licence to use, reproduce, modify, adapt,
            publish, translate, distribute, and display Your Content in connection with
            operating and promoting the Service. This licence continues until you remove
            the content or terminate your account, subject to our data retention obligations.
          </p>
          <p>
            You represent that You have all rights necessary to grant the above licence and
            that Your Content does not violate any applicable law or infringe any third-party
            rights.
          </p>
        </Subsection>

        <Subsection title="12.2 Accuracy of Content">
          <p>
            You are solely responsible for the accuracy and completeness of content you
            provide. We do not verify the accuracy of operator-submitted venue information
            and are not responsible for any inaccuracies.
          </p>
        </Subsection>
      </Section>

      <Section id="intellectual-property" title="13. Intellectual Property">
        <p>
          The Service, including its design, code, text, graphics, logos, and other content
          created by us, is owned by Yellow Lab Software and is protected by copyright,
          trademark, and other intellectual property laws.
        </p>
        <p>
          Nothing in these Terms grants you any right to use our trademarks, logos, or brand
          identifiers without our prior written consent.
        </p>
        <p>
          You may not copy, reproduce, distribute, modify, or create derivative works of
          any part of the Service without our express written permission, except as expressly
          permitted by these Terms.
        </p>
      </Section>

      <Section id="suspension-termination" title="14. Account Suspension and Termination">
        <p>
          We reserve the right to suspend or terminate your account and access to the Service,
          with or without notice, if we believe:
        </p>
        <ul>
          <li>You have violated these Terms or our policies.</li>
          <li>You have engaged in fraudulent, deceptive, or illegal activity.</li>
          <li>You have submitted unauthorized venue claims.</li>
          <li>Your account poses a risk to the security or integrity of the Service.</li>
          <li>We are required to do so by applicable law.</li>
        </ul>
        <p>
          If your account is suspended or terminated, you may not create a new account without
          our prior written consent. We are not liable to you or any third party for any
          suspension or termination of your account.
        </p>
        <p>
          You may terminate your account at any time by cancelling your venue account through
          the Operator Admin portal or by contacting us.
        </p>
      </Section>

      <Section id="service-availability" title="15. Service Availability">
        <p>
          We aim to provide a reliable and available Service, but we do not guarantee
          uninterrupted access. The Service may be temporarily unavailable due to scheduled
          maintenance, technical issues, third-party service outages, or events beyond our
          reasonable control.
        </p>
        <p>
          We reserve the right to modify, suspend, or discontinue any part of the Service
          at any time, with or without notice. We will not be liable for any modification,
          suspension, or discontinuation of the Service.
        </p>
      </Section>

      <Section id="limitation-of-liability" title="16. Limitation of Liability">
        <p>
          To the maximum extent permitted by applicable law, Happy Hour Compass and Yellow
          Lab Software, including our officers, directors, employees, and agents, shall not
          be liable for any indirect, incidental, special, consequential, or punitive damages
          arising from or related to your use of the Service, including but not limited to:
        </p>
        <ul>
          <li>Reliance on venue information that is inaccurate or outdated.</li>
          <li>Any inability to access or use the Service.</li>
          <li>Unauthorized access to your account.</li>
          <li>Loss of data or content.</li>
          <li>Any third-party conduct or content.</li>
        </ul>
        <p>
          Our aggregate liability to you for any claim arising from these Terms or the Service
          shall not exceed the greater of (a) CAD $100 or (b) the total fees you paid to us
          in the three months preceding the claim.
        </p>
        <p>
          Some jurisdictions do not allow the exclusion or limitation of certain damages.
          In those jurisdictions, our liability will be limited to the fullest extent permitted
          by law.
        </p>
      </Section>

      <Section id="indemnification" title="17. Indemnification">
        <p>
          You agree to indemnify, defend, and hold harmless Yellow Lab Software and its
          officers, directors, employees, and agents from and against any claims, liabilities,
          damages, losses, costs, and expenses (including reasonable legal fees) arising from:
        </p>
        <ul>
          <li>Your use of the Service.</li>
          <li>Your violation of these Terms.</li>
          <li>Your Content or information you submit to the Service.</li>
          <li>Your violation of any applicable law or third-party rights.</li>
        </ul>
      </Section>

      <Section id="changes-to-service" title="18. Changes to the Service">
        <p>
          We may change, update, add, or remove features of the Service at any time. We may
          also change the pricing for paid plans, provided we give you reasonable advance
          notice before the new pricing takes effect on your account.
        </p>
        <p>
          We will endeavour to communicate material changes to the Service that may affect
          your use, but we are not obligated to provide notice of every change.
        </p>
      </Section>

      <Section id="governing-law" title="19. Governing Law">
        <p>
          These Terms are governed by and construed in accordance with the laws of the
          Province of <strong>British Columbia, Canada</strong>, and the federal laws of
          Canada applicable therein, without regard to conflict of law principles.
        </p>
        <p>
          Any dispute arising from these Terms or your use of the Service shall be subject
          to the exclusive jurisdiction of the courts of British Columbia, Canada. If you
          are a consumer, you may also have rights under the consumer protection laws of
          your province or territory.
        </p>
      </Section>

      <Section id="contact" title="20. Contact Information">
        <p>
          If you have any questions about these Terms, please contact us:
        </p>
        <address className="not-italic mt-3 space-y-1 text-sm text-gray-700">
          <p><strong>Yellow Lab Software</strong></p>
          <p>1756 Sonora Drive</p>
          <p>Kelowna, BC V1Y 8K7</p>
          <p>Canada</p>
          <p className="mt-2">
            <a href="mailto:support@happyhourcompass.com" className="text-amber-600 hover:underline">
              support@happyhourcompass.com
            </a>
          </p>
        </address>
      </Section>

      <div className="mt-10 pt-6 border-t border-gray-100">
        <Link href="/privacy" className="text-sm text-amber-600 hover:underline">
          View our Privacy Policy →
        </Link>
      </div>
    </article>
  );
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8">
      <h2 className="text-base font-bold text-gray-900 mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-gray-700 leading-relaxed">{children}</div>
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-800 mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
