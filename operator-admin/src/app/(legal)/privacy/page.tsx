import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Happy Hour Compass, operated by Yellow Lab Software.",
};

const EFFECTIVE_DATE = "June 19, 2026";
const LAST_UPDATED   = "June 19, 2026";

export default function PrivacyPolicyPage() {
  return (
    <article className="prose prose-sm prose-slate max-w-none">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Privacy Policy</h1>
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
          Happy Hour Compass (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) is a service operated by Yellow Lab Software,
          a company based in Kelowna, British Columbia, Canada. Happy Hour Compass helps consumers
          discover restaurants and bars offering happy hour specials, and provides venue operators
          with tools to manage and promote their listings.
        </p>
        <p>
          This Privacy Policy explains how we collect, use, disclose, and protect personal information
          when you use our website and services (collectively, the &ldquo;Service&rdquo;). It applies to all
          visitors, consumers, venue operators, and business users of Happy Hour Compass.
        </p>
        <p>
          By using the Service, you agree to the collection and use of information in accordance
          with this policy. If you do not agree, please do not use the Service.
        </p>
        <p>
          We are committed to compliance with applicable Canadian privacy legislation, including the
          <em> Personal Information Protection and Electronic Documents Act</em> (PIPEDA) and the
          British Columbia <em>Personal Information Protection Act</em> (PIPA).
        </p>
      </Section>

      <Section id="information-we-collect" title="2. Information We Collect">
        <Subsection title="2.1 Information You Provide Directly">
          <ul>
            <li>
              <strong>Operator accounts:</strong> When you register as a venue operator, we collect
              your first name, last name, email address, and password. You may also provide your
              venue&rsquo;s business name, address, phone number, website URL, business hours,
              happy hour details, and images.
            </li>
            <li>
              <strong>Venue claim submissions:</strong> When you submit a claim to manage a venue
              listing, we collect your name, email address, phone number, and your stated role
              at the venue (e.g., owner, manager). This information is used to verify your
              association with the venue.
            </li>
            <li>
              <strong>Venue suggestions (consumers):</strong> When you suggest a venue or happy hour,
              we may collect your name, email address, and the details of the venue you are suggesting.
            </li>
            <li>
              <strong>Business owner submissions:</strong> When a business owner submits their venue
              through our operator submission flow, we collect first name, last name, position,
              street address, city, province, phone number, email address, website URL, and any
              additional notes provided.
            </li>
            <li>
              <strong>Team invitations:</strong> When accepting a team invitation to join an operator
              account, we collect the invitee&rsquo;s name and password to create their account.
            </li>
            <li>
              <strong>Contact and support:</strong> When you contact us by email, we collect your
              name, email address, and the content of your message.
            </li>
          </ul>
        </Subsection>

        <Subsection title="2.2 Information Collected Automatically">
          <p>
            When you use the Service, we automatically collect certain technical information:
          </p>
          <ul>
            <li>
              <strong>Usage data:</strong> Pages viewed, features used, time spent, and navigation
              patterns within the Service.
            </li>
            <li>
              <strong>Search activity:</strong> Search queries entered on the platform, including
              venue searches, location searches, and search tag selections.
            </li>
            <li>
              <strong>Interaction data:</strong> Venue views, event views, clicks on venue listings
              and promotional content, interactions with the Discover feed, and saved venues.
            </li>
            <li>
              <strong>Device and browser information:</strong> Browser type and version, operating
              system, device type, screen resolution, and language settings.
            </li>
            <li>
              <strong>IP address:</strong> Your IP address is collected automatically when you use
              the Service. For venue claim and submission forms, IP address is recorded as part of
              our fraud prevention and trust verification process.
            </li>
            <li>
              <strong>Referral information:</strong> How you arrived at the Service (e.g., direct
              link, search engine, referral).
            </li>
          </ul>
        </Subsection>

        <Subsection title="2.3 Information from Third Parties">
          <ul>
            <li>
              <strong>Google Places:</strong> When business owners submit their venue through our
              operator submission flow, we use the Google Places API to look up and pre-fill venue
              information based on your business name and location. This data is provided by Google
              and may include your business&rsquo;s name, address, phone number, website, opening hours,
              photos, and ratings.
            </li>
            <li>
              <strong>Payment processing:</strong> If you subscribe to a paid operator plan, billing
              information is processed by Stripe. We do not store your full payment card details.
              Stripe may share transaction information (such as plan type, billing cycle, and payment
              status) with us.
            </li>
          </ul>
        </Subsection>
      </Section>

      <Section id="cookies" title="3. Cookies and Local Storage">
        <p>
          We use cookies and similar technologies to operate and improve the Service.
        </p>
        <ul>
          <li>
            <strong>Authentication cookies:</strong> Supabase, our authentication and database
            provider, sets cookies required to maintain your logged-in session. These are essential
            for the Service to function.
          </li>
          <li>
            <strong>Preference storage:</strong> We use browser local storage to remember your
            preferences, such as your selected market or city, to personalize your experience
            across sessions.
          </li>
          <li>
            <strong>Analytics:</strong> We use Vercel Analytics and Vercel Speed Insights to
            collect anonymized usage data. These services may use cookies or similar technologies
            to track page views and performance metrics.
          </li>
        </ul>
        <p>
          You can control cookies through your browser settings. Disabling essential cookies
          may affect your ability to sign in or use certain features of the Service.
        </p>
      </Section>

      <Section id="how-we-use" title="4. How We Use Information">
        <p>We use the personal information we collect to:</p>
        <ul>
          <li>Create and manage your operator account and venue listings.</li>
          <li>Verify venue claims and ownership submissions.</li>
          <li>Provide and personalize the consumer experience, including venue discovery,
            search results, and saved venues.</li>
          <li>Process payments and manage subscriptions for paid operator plans.</li>
          <li>Send transactional emails such as account confirmation, password resets,
            claim status notifications, team invitations, and subscription receipts.</li>
          <li>Send marketing and promotional communications if you have opted in, or where
            permitted under applicable law. You may unsubscribe at any time.</li>
          <li>Improve and analyze the performance of the Service, including understanding
            which features are most used and identifying areas for improvement.</li>
          <li>Prevent fraud, abuse, unauthorized access, and other security threats.</li>
          <li>Comply with applicable legal obligations.</li>
          <li>Respond to your inquiries and support requests.</li>
        </ul>
      </Section>

      <Section id="email-communications" title="5. Email Communications">
        <p>We send the following types of email communications:</p>
        <ul>
          <li>
            <strong>Transactional emails (mandatory):</strong> Account confirmations, password
            reset links, claim approval or rejection notifications, team invitation emails,
            operator onboarding emails, and subscription receipts. These emails are necessary
            to operate the Service and cannot be opted out of while you maintain an account.
          </li>
          <li>
            <strong>Marketing emails (optional):</strong> Newsletters, platform updates,
            promotional announcements, and feature highlights. Where required, we will obtain
            your explicit consent before sending marketing emails. You may withdraw consent
            at any time by using the unsubscribe link in any marketing email or by contacting
            us at <a href="mailto:support@happyhourcompass.com">support@happyhourcompass.com</a>.
          </li>
        </ul>
        <p>
          We send email using Resend, a third-party email delivery service. Your email address
          is shared with Resend solely for the purpose of delivering messages on our behalf.
        </p>
      </Section>

      <Section id="how-we-share" title="6. How We Share Information">
        <p>
          <strong>We do not sell your personal information.</strong>
        </p>
        <p>We may share personal information in the following circumstances:</p>
        <ul>
          <li>
            <strong>Service providers:</strong> We share information with trusted third-party
            service providers who process data on our behalf (see Section 7). These providers
            are contractually required to protect your information and may not use it for
            their own purposes.
          </li>
          <li>
            <strong>Within your organization:</strong> If you are an operator with team members,
            information about your venue and account may be accessible to other members of
            your operator team.
          </li>
          <li>
            <strong>Venue information:</strong> Venue listings, happy hour details, and
            operator-provided content (excluding personal contact details) are displayed
            publicly on the Service to consumers.
          </li>
          <li>
            <strong>Legal requirements:</strong> We may disclose information if required to
            do so by law, court order, or governmental authority, or to protect the rights,
            property, or safety of Happy Hour Compass, our users, or the public.
          </li>
          <li>
            <strong>Business transfers:</strong> In the event of a merger, acquisition, or
            sale of all or part of our assets, personal information may be transferred as
            part of that transaction. We will notify you of any such change.
          </li>
        </ul>
      </Section>

      <Section id="third-party-services" title="7. Third-Party Services">
        <p>We use the following third-party services to operate the platform:</p>
        <ul>
          <li>
            <strong>Supabase</strong> — Database, authentication, and file storage. Your
            account credentials and venue data are stored on Supabase infrastructure.
            Supabase is hosted on AWS.{" "}
            <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">
              Supabase Privacy Policy
            </a>
          </li>
          <li>
            <strong>Vercel</strong> — Hosting and deployment platform for our web application.
            Vercel also provides analytics and performance monitoring services that collect
            anonymized usage data.{" "}
            <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
              Vercel Privacy Policy
            </a>
          </li>
          <li>
            <strong>Resend</strong> — Email delivery service used to send transactional and
            marketing emails.{" "}
            <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
              Resend Privacy Policy
            </a>
          </li>
          <li>
            <strong>Stripe</strong> — Payment processing for operator subscriptions. Stripe
            collects and processes your billing information in accordance with their privacy
            policy.{" "}
            <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">
              Stripe Privacy Policy
            </a>
          </li>
          <li>
            <strong>Google</strong> — We use the Google Places API (New) to assist with venue
            lookup during the owner submission flow. Google Maps static images and Street View
            imagery may be displayed on the platform. Your use of these features is also governed
            by Google&rsquo;s privacy policy.{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              Google Privacy Policy
            </a>
          </li>
        </ul>
        <p>
          We are not responsible for the privacy practices of these third parties. We encourage
          you to review their privacy policies.
        </p>
      </Section>

      <Section id="data-retention" title="8. Data Retention">
        <p>
          We retain personal information for as long as necessary to provide the Service,
          fulfill the purposes outlined in this policy, and comply with our legal obligations.
        </p>
        <ul>
          <li>
            <strong>Operator accounts:</strong> Account data is retained while your account
            is active. If you cancel your venue account, your venue data and historical records
            (claims, analytics, notes) are preserved but your venue listing is unpublished.
            You may request deletion of your personal data by contacting us.
          </li>
          <li>
            <strong>Venue claims:</strong> Claim data, including name, email, phone, and role,
            is retained for fraud prevention and audit purposes.
          </li>
          <li>
            <strong>Usage and analytics data:</strong> Anonymized usage data may be retained
            indefinitely for analytics and product improvement.
          </li>
          <li>
            <strong>Marketing consent records:</strong> Records of consent and opt-out are
            retained as required by applicable law.
          </li>
        </ul>
      </Section>

      <Section id="security" title="9. Security">
        <p>
          We take reasonable technical and organizational measures to protect personal information
          against unauthorized access, disclosure, alteration, and destruction. Our measures include:
        </p>
        <ul>
          <li>Encrypted data transmission (HTTPS/TLS).</li>
          <li>Row-Level Security (RLS) in our database, ensuring each operator can only access
            their own data.</li>
          <li>Supabase-managed authentication with secure session tokens.</li>
          <li>Access controls limiting which team members can access sensitive data.</li>
          <li>Service-role keys are kept server-side and never exposed to the browser.</li>
        </ul>
        <p>
          No method of transmission over the internet or electronic storage is 100% secure.
          While we strive to protect your information, we cannot guarantee absolute security.
          If you become aware of any security issue, please contact us immediately at{" "}
          <a href="mailto:support@happyhourcompass.com">support@happyhourcompass.com</a>.
        </p>
      </Section>

      <Section id="your-rights" title="10. Your Rights and Choices">
        <p>
          Depending on your location and applicable law, you may have the following rights
          with respect to your personal information:
        </p>
        <ul>
          <li>
            <strong>Access:</strong> Request a copy of the personal information we hold about you.
          </li>
          <li>
            <strong>Correction:</strong> Request correction of inaccurate or incomplete
            personal information.
          </li>
          <li>
            <strong>Deletion:</strong> Request deletion of your personal information, subject
            to our legal retention obligations.
          </li>
          <li>
            <strong>Withdrawal of consent:</strong> Where processing is based on your consent
            (such as marketing emails), you may withdraw consent at any time. Withdrawal does
            not affect the lawfulness of processing prior to withdrawal.
          </li>
          <li>
            <strong>Opt out of marketing:</strong> You may unsubscribe from marketing
            communications at any time using the unsubscribe link in those emails or by
            contacting us.
          </li>
        </ul>
        <p>
          To exercise any of these rights, please contact us at{" "}
          <a href="mailto:support@happyhourcompass.com">support@happyhourcompass.com</a>.
          We will respond to your request within a reasonable timeframe and in accordance
          with applicable law.
        </p>
        <p>
          If you believe your privacy rights have not been adequately addressed, you may have
          the right to lodge a complaint with the Office of the Privacy Commissioner of Canada
          or the Office of the Information and Privacy Commissioner of British Columbia.
        </p>
      </Section>

      <Section id="childrens-privacy" title="11. Children's Privacy">
        <p>
          Happy Hour Compass is a service related to bars, restaurants, and alcohol-serving
          establishments. The Service is not directed to individuals under the legal drinking
          age in their jurisdiction, and in any case not to anyone under the age of 18.
        </p>
        <p>
          We do not knowingly collect personal information from children under 18. If you
          believe we have inadvertently collected information from a minor, please contact
          us immediately at{" "}
          <a href="mailto:support@happyhourcompass.com">support@happyhourcompass.com</a>{" "}
          and we will take steps to delete it.
        </p>
      </Section>

      <Section id="international-transfers" title="12. International Data Transfers">
        <p>
          Happy Hour Compass is operated from Canada. However, some of our service providers
          process data outside of Canada, including in the United States (Supabase, Vercel,
          Stripe, Resend, Google). By using the Service, you acknowledge that your information
          may be transferred to and processed in countries with different data protection laws
          than your own.
        </p>
        <p>
          We work with service providers who maintain appropriate safeguards for cross-border
          transfers of personal data.
        </p>
      </Section>

      <Section id="changes" title="13. Changes to This Privacy Policy">
        <p>
          We may update this Privacy Policy from time to time. When we make material changes,
          we will update the &ldquo;Last Updated&rdquo; date at the top of this page and, where appropriate,
          notify you by email or by displaying a notice within the Service.
        </p>
        <p>
          We encourage you to review this policy periodically. Your continued use of the
          Service after any changes constitutes your acceptance of the updated policy.
        </p>
      </Section>

      <Section id="contact" title="14. Contact Information">
        <p>
          If you have any questions, concerns, or requests regarding this Privacy Policy or
          our privacy practices, please contact us:
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
        <Link href="/terms" className="text-sm text-amber-600 hover:underline">
          View our Terms of Service →
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
