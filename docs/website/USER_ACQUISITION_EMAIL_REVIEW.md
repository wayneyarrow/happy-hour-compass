# Happy Hour Compass — User Acquisition Email Review

**Prepared:** 2026-07-01  
**Purpose:** Product and design review of every acquisition email currently in production. Not an engineering review.  
**Scope:** Four flows — Suggest a Venue, Submit / List Your Venue, Claim a Venue, Contact Us.  
**Source files:** `operator-admin/src/lib/email.ts`, and the action files for each flow.

---

## How to Read This Document

Each email is documented with:
- **Metadata block** (trigger, sender, recipient, criticality, blocking status)
- **Rendered email preview** in clean Markdown representing the actual customer experience
- **CTA block** (button text, destination, secondary links)
- **Branding block** (logo, header, footer, colours, sign-off)
- **Type classification** (internal / customer confirmation / customer action required)

---

---

# Flow 1: Suggest a Venue

Consumer flow. Entry point: `/suggest/customer` in the `(consumer)` app.  
Source action: `src/app/(consumer)/suggest/customer/actions.ts`

---

## Email 1.1 — Suggestion Founder Notification

| Field | Value |
|---|---|
| **Email name** | `suggestion_notification` |
| **Purpose** | Notifies founder that a consumer submitted a new venue suggestion |
| **Trigger** | Immediately after the suggestion is successfully inserted into `venue_suggestions` |
| **Recipient** | Founder (`FOUNDER_NOTIFICATION_EMAIL` env var, defaults to `wayne.yarrow@gmail.com`) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `New happy hour suggestion: {Venue Name} ({City})` |
| **Criticality** | `standard` |
| **Blocking / Non-blocking** | Non-blocking — email failure is logged but does not prevent the consumer seeing success |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**New happy hour suggestion**

| | |
|---|---|
| Venue | {Venue Name} |
| City | {City} |
| Notes | {Notes, if provided} |
| Name | {Customer Name, if provided} |
| Email | {Customer Email, if provided} |
| Marketing opt-in | **Yes** (green badge) / **No** (grey badge) — shown only if email was provided |
| Submitted | {date/time, Pacific time} |

{Suggestion ID: uuid}

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

Happy Hour Compass · Consumer suggestion notification

---

### CTA

| Field | Value |
|---|---|
| **Button** | None — data table only, no CTA button |
| **Secondary links** | None |

> Note: Unlike the claim and submission notifications, this email contains no CTA button. There is no deep link to a control panel review page for suggestions.

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, `{APP_URL}/logo.png`, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Centered text, bold brand name, tagline, website + email links, custom footer note |
| **Primary colour** | Amber `#d97706` (links in footer) |
| **Sign-off** | None — operational notification only |

### Type

**Internal operational email** — recipient is the founder only.

---

---

## Email 1.2 — Suggestion Submitter Confirmation

| Field | Value |
|---|---|
| **Email name** | `suggestion_confirmation` |
| **Purpose** | Confirms to the consumer that their venue suggestion was received |
| **Trigger** | Immediately after Email 1.1, if the consumer provided their email address |
| **Recipient** | Consumer (if they entered an email on the suggestion form — optional field) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `Thanks for your Happy Hour Compass suggestion` |
| **Criticality** | `standard` |
| **Blocking / Non-blocking** | Non-blocking — email failure does not block the consumer success state |

---

### Rendered Email — Variant A: Consumer opted in to marketing

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**Thanks for the suggestion!**

Hi {Customer Name},

Thanks for suggesting **{Venue Name}**. We appreciate you helping us make Happy Hour Compass better.

We'll review the suggestion and may add it to the directory if it looks like a good fit.

Since you opted in, we may also send you occasional updates about your suggestion and Happy Hour Compass news. You can reply to any of our emails to opt out at any time.

---

**Keep an eye on your inbox**  
Our reply may land in your spam or junk folder. Please add **hello@happyhourcompass.com** to your contacts to make sure you don't miss it.

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you suggested a venue on Happy Hour Compass.

---

### Rendered Email — Variant B: Consumer did NOT opt in to marketing

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**Thanks for the suggestion!**

Hi {Customer Name},

Thanks for suggesting **{Venue Name}**. We appreciate you helping us make Happy Hour Compass better.

We'll review the suggestion and may add it to the directory if it looks like a good fit.

---

**Keep an eye on your inbox**  
Our reply may land in your spam or junk folder. Please add **hello@happyhourcompass.com** to your contacts to make sure you don't miss it.

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you suggested a venue on Happy Hour Compass.

---

> Note: If the consumer did not provide a name, the greeting reads "Hi there," in both variants.

---

### CTA

| Field | Value |
|---|---|
| **Button** | None |
| **Secondary links** | None |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, `{APP_URL}/logo.png`, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Centered text, bold brand name, tagline, website + email links, custom footer note |
| **Primary colour** | Amber `#d97706` (spam callout border and heading) |
| **Sign-off** | None — no personal sign-off |

### Type

**Customer confirmation** — purely transactional. No action required from the recipient.

---

---

## Flow 1 Summary

### Emails Sent

| Status | Email | Recipient |
|---|---|---|
| Always | Suggestion Founder Notification (1.1) | Founder |
| Only if email provided | Suggestion Submitter Confirmation (1.2) | Consumer |

### Emails NOT Sent

- No follow-up email to the consumer when/if the suggested venue is added to the directory.
- No email to the consumer if the suggestion is reviewed and not added.
- No personalised sign-off from Wayne in the confirmation email.

### Conditional Paths

```
Consumer submits suggestion
  └─ Suggestion inserted into DB
       ├─ ALWAYS: Suggestion Founder Notification sent (1.1)
       └─ IF consumer provided email:
            └─ Suggestion Submitter Confirmation sent (1.2)
                 ├─ IF marketing opt-in: includes opt-in acknowledgement paragraph
                 └─ IF no opt-in: purely transactional copy
```

---

---

# Flow 2: Submit / List Your Venue (Operator Submission)

Operator acquisition flow. Entry point: `/suggest/owner` in the `(consumer)` app.  
Source actions: `src/app/(consumer)/suggest/owner/actions.ts`, `src/app/control-panel/operator-submissions/[id]/actions.ts`, `src/app/(standalone)/suggest/owner/more-info/[token]/actions.ts`

This flow has multiple phases with different email states depending on routing outcomes.

---

## Email 2.1 — Operator Submission Founder Notification

| Field | Value |
|---|---|
| **Email name** | `operator_submission_notification` |
| **Purpose** | Notifies founder when an operator submits their business via the list-your-venue flow |
| **Trigger** | Immediately after submission is inserted into `operator_submissions` (all routing outcomes) |
| **Recipient** | Founder (`FOUNDER_NOTIFICATION_EMAIL`, defaults to `wayne.yarrow@gmail.com`) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `New operator submission: {Business Name} ({City}) — {match_status}` |
| **Criticality** | `important` |
| **Blocking / Non-blocking** | Non-blocking — email failure is caught and logged; the submission row is already inserted |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**New operator submission**

| | |
|---|---|
| Business | {Business Name} |
| Location | {City}, {Province} |
| Submitter | {First Name} {Last Name} |
| Email | {Submitter Email} |
| Match status | **confirmed** (green badge) / **rejected** (red badge) / **no_match** (amber badge) |
| Routed as | {routed_status value} |
| Submitted | {date/time, Pacific time} |

**[Review submission →]** *(amber CTA button, links to `/control-panel/operator-submissions/{id}`)*

Or copy: {review URL}

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

Happy Hour Compass · Operator submission notification

---

### CTA

| Field | Value |
|---|---|
| **Button text** | Review submission → |
| **Destination** | `/control-panel/operator-submissions/{submission-id}` |
| **Secondary links** | Plain-text URL fallback below button |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` (CTA button) |
| **Sign-off** | None — operational notification only |

### Type

**Internal operational email** — recipient is the founder only.

---

---

## Email 2.2 — Operator Activation (Auto-confirmed Path)

| Field | Value |
|---|---|
| **Email name** | `operator_activation` |
| **Purpose** | Sends the operator a password setup link to access their new Operator Admin account when their submission was auto-confirmed via Google Places matching |
| **Trigger** | During `saveOperatorSubmissionAction`, when `routedStatus === "confirmed_auto"` — operator account is provisioned before the submission row is inserted |
| **Recipient** | Business submitter (their email from the submission form) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `Your venue is on Happy Hour Compass — set up your account` |
| **Criticality** | `critical` |
| **Blocking / Non-blocking** | **Blocking** — provisioning (including email) must succeed before the submission row is created. If it fails, the submitter sees an error and can retry. |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**Your venue is on Happy Hour Compass**

Hi {First Name},

Your venue has been added to Happy Hour Compass. Click the button below to set up your Operator Admin account and start managing your listing.

**[Set up my account →]** *(amber CTA button, links to Supabase recovery link)*

This link expires within 24 hours. If it expires, contact us and we'll send a new one.

Or copy this URL: {Supabase recovery action link}

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you submitted a venue on Happy Hour Compass.

---

### CTA

| Field | Value |
|---|---|
| **Button text** | Set up my account → |
| **Destination** | Supabase-generated recovery action link → redirects to `/operator/create-password` |
| **Secondary links** | Plain-text URL fallback below button |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` (CTA button) |
| **Sign-off** | None — no personal sign-off from Wayne |

### Type

**Customer action required** — recipient must click within 24 hours to set up their account.

---

---

## Email 2.3 — Submission More Info Request (Founder-triggered)

| Field | Value |
|---|---|
| **Email name** | `operator_submission_more_info` |
| **Purpose** | Sends the submitter a secure link to complete a structured verification form when automatic Google matching failed |
| **Trigger** | When founder clicks "Request more info" in the Control Panel (`/control-panel/operator-submissions/{id}`) |
| **Recipient** | Business submitter |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `More information needed for your venue submission — {Venue Name}` |
| **Criticality** | `important` |
| **Blocking / Non-blocking** | **Blocking** — if this email fails, the founder receives an error and must retry or contact the submitter directly. The DB status is already updated to `needs_more_info`. |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**A few more details needed**

Hi {First Name},

Thanks for submitting **{Venue Name}** to Happy Hour Compass.

We weren't able to automatically verify your venue, so we need a few additional details before we can create your operator account. Please click the button below to complete a short verification form — it only takes a couple of minutes.

**[Complete verification →]** *(amber CTA button, links to `/suggest/owner/more-info/{token}`)*

This link expires in 72 hours. If it expires, reply to this email and we'll send a new one.

Or copy this URL: {secure token URL}

---

**What happens next?**

1. Complete the short verification form using the link above.
2. We'll review the details you provide.
3. Once verified, you'll receive a link to set up your operator account.

---

**Keep an eye on your inbox**  
Our reply may land in your spam or junk folder. Please add **hello@happyhourcompass.com** to your contacts to make sure you don't miss it.

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you submitted a venue on Happy Hour Compass.

---

### CTA

| Field | Value |
|---|---|
| **Button text** | Complete verification → |
| **Destination** | `/suggest/owner/more-info/{72-hour token}` |
| **Secondary links** | Plain-text URL fallback below button |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` (CTA button, "What happens next?" step numbers) |
| **Sign-off** | None — no personal sign-off from Wayne |

### Type

**Customer action required** — recipient must complete the verification form within 72 hours.

---

---

## Email 2.4 — Info Submitted Founder Notification

| Field | Value |
|---|---|
| **Email name** | `operator_submission_info_submitted` |
| **Purpose** | Notifies founder that a submitter has completed the structured verification form |
| **Trigger** | When submitter successfully submits the more-info form at `/suggest/owner/more-info/{token}` |
| **Recipient** | Founder (`FOUNDER_NOTIFICATION_EMAIL`, defaults to `wayne.yarrow@gmail.com`) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `Info submitted: {Business Name} — ready for review` |
| **Criticality** | `important` |
| **Blocking / Non-blocking** | Non-blocking — submitter success is not held back by email failure |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**Additional information submitted**

| | |
|---|---|
| Business | {Business Name} |
| Submitter | {First Name} {Last Name} |
| Email | {Submitter Email} |
| Status | **Info submitted** (purple badge) |
| Submitted | {date/time, Pacific time} |

The submitter has completed the additional verification form. Open the submission to review their details.

**[Review submission →]** *(amber CTA button, links to `/control-panel/operator-submissions/{id}`)*

Or copy: {review URL}

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

Happy Hour Compass · Operator submission notification

---

### CTA

| Field | Value |
|---|---|
| **Button text** | Review submission → |
| **Destination** | `/control-panel/operator-submissions/{submission-id}` |
| **Secondary links** | Plain-text URL fallback below button |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` (CTA button); purple `#7c3aed` (status badge) |
| **Sign-off** | None — operational notification only |

### Type

**Internal operational email** — recipient is the founder only.

---

---

## Email 2.5 — Operator Activation (Manual Approval Path)

| Field | Value |
|---|---|
| **Email name** | `operator_activation` |
| **Purpose** | Sends the operator a password setup link when the founder manually approves a submission via "Approve & Create Venue" in the Control Panel |
| **Trigger** | When founder clicks "Approve & Create Venue" on a `needs_more_info`, `no_match`, `info_submitted`, or `rejected_by_user` submission |
| **Recipient** | Business submitter |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `Your venue is on Happy Hour Compass — set up your account` |
| **Criticality** | `critical` |
| **Blocking / Non-blocking** | **Blocking** — provisioning must succeed (email included) before the submission status is updated |

**Rendered email is identical to Email 2.2.**

---

### CTA

Same as Email 2.2 — "Set up my account →" button pointing to Supabase recovery link.

---

### Type

**Customer action required** — same experience as auto-confirmed path.

---

---

## Email 2.6 — Submission Closed Notification

| Field | Value |
|---|---|
| **Email name** | `operator_submission_closed` |
| **Purpose** | Courtesy email notifying the submitter that their submission was reviewed and cannot be accepted at this time |
| **Trigger** | When founder clicks "Reject / Close" on a submission in the Control Panel |
| **Recipient** | Business submitter |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `Your Happy Hour Compass submission — {Venue Name}` |
| **Criticality** | `important` |
| **Blocking / Non-blocking** | Non-blocking — the submission is closed regardless of whether this email reaches the submitter |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**About your submission**

Hi {First Name},

Thanks for taking the time to submit **{Venue Name}** to Happy Hour Compass.

After reviewing your submission, we weren't able to add the venue to our platform at this time. We appreciate your interest and apologise for any inconvenience.

If you have additional information that might help, or if you think this decision was made in error, please don't hesitate to reply to this email — we're happy to take another look.

Thanks again,  
**Wayne**  
Founder, Happy Hour Compass

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you submitted a venue on Happy Hour Compass.

---

### CTA

| Field | Value |
|---|---|
| **Button** | None |
| **Secondary links** | None — recipient is asked to reply to this email if they have more information |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` — not visible in this email body (no CTA button) |
| **Sign-off** | **Wayne** / Founder, Happy Hour Compass |

### Type

**Customer confirmation** — informs recipient of an outcome, no action required.

---

---

## Flow 2 Summary

### Emails Sent

| Phase | Routing outcome | Email | Recipient |
|---|---|---|---|
| On submission | All outcomes | Operator Submission Founder Notification (2.1) | Founder |
| On submission | `confirmed_auto` only | Operator Activation (2.2) | Submitter |
| CP review — needs more info | Any reviewable status | Submission More Info Request (2.3) | Submitter |
| Submitter completes more-info form | After 2.3 | Info Submitted Founder Notification (2.4) | Founder |
| CP review — manual approval | `no_match`, `needs_more_info`, `info_submitted`, `rejected_by_user` | Operator Activation (2.5) | Submitter |
| CP review — close | Any reviewable status | Submission Closed Notification (2.6) | Submitter |

### Emails NOT Sent

- No customer-facing confirmation email to the submitter immediately after they submit the form (for `no_match`, `rejected_by_user`, `pending_review`, `double_claim` paths — the submitter sees an on-screen success state only).
- No email to submitters in `pending_review` or `double_claim` status.

### Conditional Paths

```
Operator submits venue
  └─ Google Places match attempted
       ├─ confirmed_auto (auto-matched, unclaimed, new venue created)
       │    ├─ Operator Activation email sent (2.2) — BLOCKING
       │    └─ Operator Submission Founder Notification sent (2.1) — non-blocking
       │
       ├─ pending_review (matched existing unclaimed venue)
       │    └─ Operator Submission Founder Notification sent (2.1) — non-blocking
       │    ▼ CP: "Approve & Create Venue"
       │         └─ Operator Activation sent (2.5) — BLOCKING
       │    ▼ CP: "Request more info"
       │         └─ Submission More Info Request sent (2.3) — BLOCKING
       │              └─ Submitter completes form
       │                   └─ Info Submitted Founder Notification sent (2.4) — non-blocking
       │    ▼ CP: "Reject / Close"
       │         └─ Submission Closed Notification sent (2.6) — non-blocking
       │
       ├─ double_claim (venue exists and is already claimed)
       │    └─ Operator Submission Founder Notification sent (2.1) — non-blocking
       │    (no further automated emails — requires founder manual action)
       │
       ├─ no_match (Google returned nothing)
       │    └─ Operator Submission Founder Notification sent (2.1) — non-blocking
       │    ▼ CP: "Approve & Create Venue"
       │         └─ Operator Activation sent (2.5) — BLOCKING
       │    ▼ CP: "Request more info"
       │         └─ Submission More Info Request sent (2.3) — BLOCKING
       │              └─ Submitter completes form
       │                   └─ Info Submitted Founder Notification sent (2.4) — non-blocking
       │    ▼ CP: "Reject / Close"
       │         └─ Submission Closed Notification sent (2.6) — non-blocking
       │
       └─ rejected_by_user (submitter declined the Google match)
            └─ Operator Submission Founder Notification sent (2.1) — non-blocking
            ▼ Same CP review paths as no_match above
```

---

---

# Flow 3: Claim a Venue

Consumer flow. Entry point: `/venue/{id}/claim` in the `(consumer)` app.  
Source actions: `src/app/(consumer)/venue/[id]/claim/actions.ts`, `src/app/control-panel/claims/[id]/actions.ts`, `src/app/(standalone)/claim/more-info/[token]/actions.ts`

---

## Email 3.1 — Claim Founder Notification

| Field | Value |
|---|---|
| **Email name** | `claim_notification` |
| **Purpose** | Notifies founder when a consumer submits a venue ownership claim |
| **Trigger** | Immediately after the claim is inserted into `venue_claims` |
| **Recipient** | Founder (`FOUNDER_NOTIFICATION_EMAIL`, defaults to `wayne.yarrow@gmail.com`) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `New claim: {Venue Name} — {First Name} {Last Name}` |
| **Criticality** | `important` |
| **Blocking / Non-blocking** | Non-blocking — email failure is caught and logged; the claim record already exists |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**New venue claim submitted**

| | |
|---|---|
| Venue | {Venue Name} |
| Name | {First Name} {Last Name} |
| Email | {Claimant Email} |
| Phone | {Phone Number} |
| Submitted | {date/time, Pacific time} |

**[Review claim →]** *(amber CTA button, links to `/control-panel/claims/{claim-id}`)*

Or copy: {review URL}

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

Happy Hour Compass · Control Panel notification

---

### CTA

| Field | Value |
|---|---|
| **Button text** | Review claim → |
| **Destination** | `/control-panel/claims/{claim-id}` |
| **Secondary links** | Plain-text URL fallback below button |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` (CTA button) |
| **Sign-off** | None — operational notification only |

### Type

**Internal operational email** — recipient is the founder only.

---

---

## Email 3.2 — Claim Submission Confirmation (to Claimant)

| Field | Value |
|---|---|
| **Email name** | `claim_submission_confirmation` |
| **Purpose** | Acknowledges to the claimant that their ownership claim was received |
| **Trigger** | Immediately after Email 3.1, in the same action |
| **Recipient** | Claimant (email they provided on the claim form) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `We received your claim — {Venue Name}` |
| **Criticality** | `standard` |
| **Blocking / Non-blocking** | Non-blocking — email failure is logged but does not affect the success state |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**We received your claim**

Hi {First Name},

Thanks for submitting your ownership claim for **{Venue Name}** on Happy Hour Compass.

We'll review your claim shortly. If we need any additional information, we'll reach out to you at this email address.

---

**What happens next?**

1. We review your ownership claim (usually within 1–2 business days).
2. If we need anything else, we'll reach out to you at this email address.
3. Once approved, you'll receive a link to set up your operator account.

---

**Keep an eye on your inbox**  
Our reply may land in your spam or junk folder. Please add **hello@happyhourcompass.com** to your contacts to make sure you don't miss it.

Cheers,  
**Wayne**  
Founder, Happy Hour Compass

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you submitted a venue claim on Happy Hour Compass.

---

### CTA

| Field | Value |
|---|---|
| **Button** | None |
| **Secondary links** | None — recipient is asked to watch for HHC's reply |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` ("What happens next?" step numbers, spam callout border) |
| **Sign-off** | **Wayne** / Founder, Happy Hour Compass |

### Type

**Customer confirmation** — acknowledges receipt. No action required from recipient.

---

---

## Email 3.3 — Claim More Info Request (Founder-triggered, Tokenised)

| Field | Value |
|---|---|
| **Email name** | `claim_more_info` |
| **Purpose** | Sends the claimant a secure link to a structured verification form so they can provide ownership evidence |
| **Trigger** | When founder clicks "Request more info" in the Control Panel on a pending claim |
| **Recipient** | Claimant |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `More information needed for your venue claim — {Venue Name}` |
| **Criticality** | `important` |
| **Blocking / Non-blocking** | **Blocking** — if the email fails, the founder receives an error and must retry or contact the claimant directly. The DB status is already updated to `needs_more_info`. |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**A few more details needed**

Hi {First Name},

Thanks for submitting your ownership claim for **{Venue Name}** on Happy Hour Compass.

We need a few additional details to verify your ownership before we can grant you access to manage this listing. Please click the button below — it only takes a couple of minutes.

**[Complete verification →]** *(amber CTA button, links to `/claim/more-info/{token}`)*

This link expires in 72 hours. If it expires, reply to this email and we'll send a new one.

Or copy this URL: {secure token URL}

---

**What happens next?**

1. Complete the short verification form using the link above.
2. We'll review the details you provide.
3. Once verified, you'll receive a link to set up your operator account.

---

**Keep an eye on your inbox**  
Our reply may land in your spam or junk folder. Please add **hello@happyhourcompass.com** to your contacts to make sure you don't miss it.

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you submitted a venue claim on Happy Hour Compass.

---

### CTA

| Field | Value |
|---|---|
| **Button text** | Complete verification → |
| **Destination** | `/claim/more-info/{72-hour token}` |
| **Secondary links** | Plain-text URL fallback below button |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` (CTA button, "What happens next?" step numbers) |
| **Sign-off** | None — no personal sign-off from Wayne |

### Type

**Customer action required** — recipient must complete the verification form within 72 hours.

---

---

## Email 3.4 — Claim Verification Submitted Founder Notification

| Field | Value |
|---|---|
| **Email name** | `claim_info_submitted` |
| **Purpose** | Notifies founder that a claimant has completed the structured verification form |
| **Trigger** | When claimant successfully submits the more-info form at `/claim/more-info/{token}` |
| **Recipient** | Founder (`FOUNDER_NOTIFICATION_EMAIL`, defaults to `wayne.yarrow@gmail.com`) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `Info submitted: {Venue Name} claim — ready for review` |
| **Criticality** | `important` |
| **Blocking / Non-blocking** | Non-blocking — claimant success state is not held back by email failure |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**Claim verification submitted**

| | |
|---|---|
| Venue | {Venue Name} |
| Claimant | {First Name} {Last Name} |
| Email | {Claimant Email} |
| Status | **Info submitted** (purple badge) |
| Submitted | {date/time, Pacific time} |

The claimant has completed the verification form. Open the claim to review their details.

**[Review claim →]** *(amber CTA button, links to `/control-panel/claims/{claim-id}`)*

Or copy: {review URL}

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

Happy Hour Compass · Venue claim notification

---

### CTA

| Field | Value |
|---|---|
| **Button text** | Review claim → |
| **Destination** | `/control-panel/claims/{claim-id}` |
| **Secondary links** | Plain-text URL fallback below button |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` (CTA button); purple `#7c3aed` (status badge) |
| **Sign-off** | None — operational notification only |

### Type

**Internal operational email** — recipient is the founder only.

---

---

## Email 3.5 — Claim Approval — Password Setup (to Claimant)

| Field | Value |
|---|---|
| **Email name** | `claim_approval` |
| **Purpose** | Sends the claimant a Supabase password setup link granting access to their Operator Admin account |
| **Trigger** | When founder clicks "Approve" on a claim in the Control Panel |
| **Recipient** | Claimant |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `Your Happy Hour Compass claim was approved — set up your password` |
| **Criticality** | `critical` |
| **Blocking / Non-blocking** | **Blocking** — the full provisioning flow (create auth user, operator row, link venue, generate link, send email) must succeed. Full rollback on any step failure. |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**Your venue claim was approved**

Hi {First Name},

Great news — your venue ownership claim has been reviewed and approved. Click the button below to set your password and access your operator account.

**[Set up my password →]** *(amber CTA button, links to Supabase recovery link)*

This link expires within 24 hours. If it expires, contact us and we can send a new one.

Or copy this URL: {Supabase recovery action link}

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you submitted a venue claim on Happy Hour Compass.

---

### CTA

| Field | Value |
|---|---|
| **Button text** | Set up my password → |
| **Destination** | Supabase-generated recovery action link → redirects to `/operator/create-password` |
| **Secondary links** | Plain-text URL fallback below button |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` (CTA button) |
| **Sign-off** | None — no personal sign-off from Wayne |

### Type

**Customer action required** — recipient must click within 24 hours to set up their account.

---

---

## Flow 3 Summary

### Emails Sent

| Phase | Email | Recipient |
|---|---|---|
| On claim submission | Claim Founder Notification (3.1) | Founder |
| On claim submission | Claim Submission Confirmation (3.2) | Claimant |
| CP review — needs more info | Claim More Info Request (3.3) | Claimant |
| Claimant completes more-info form | Claim Verification Submitted Notification (3.4) | Founder |
| CP review — approve | Claim Approval — Password Setup (3.5) | Claimant |
| CP review — reject | (none) | — |

### Emails NOT Sent

- No email to the claimant when their claim is **rejected**. Rejection only updates the DB record; no customer communication is sent.

### Conditional Paths

```
Consumer submits claim
  ├─ Claim Founder Notification sent (3.1) — non-blocking
  └─ Claim Submission Confirmation sent (3.2) — non-blocking
       ▼ CP: "Approve"
            └─ Claim Approval — Password Setup sent (3.5) — BLOCKING
       ▼ CP: "Request more info"
            └─ Claim More Info Request sent (3.3) — BLOCKING
                 └─ Claimant completes form
                      └─ Claim Verification Submitted Notification sent (3.4) — non-blocking
                           ▼ CP: "Approve"
                                └─ Claim Approval — Password Setup sent (3.5) — BLOCKING
       ▼ CP: "Reject"
            └─ (no email sent)
```

---

---

# Flow 4: Contact Us

Consumer flow. Entry point: `/contact` in the `(consumer)` app.  
Source action: `src/app/(consumer)/contact/actions.ts`

---

## Email 4.1 — Contact Founder Notification

| Field | Value |
|---|---|
| **Email name** | `contact_founder_notification` |
| **Purpose** | Notifies founder when a visitor submits the Contact Us form |
| **Trigger** | After the message is inserted into `contact_messages` |
| **Recipient** | Founder (`FOUNDER_NOTIFICATION_EMAIL`, defaults to `wayne.yarrow@gmail.com`) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `New contact message from {Name or Email}` |
| **Criticality** | `important` |
| **Blocking / Non-blocking** | **Blocking** — if this email fails, the action returns an error to the user and the submitter does not see a success state |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**New contact message**

| | |
|---|---|
| Email | {Submitter Email} |
| Name | {Submitter Name, if provided} |
| Submitted | {date/time, Pacific time} |

**Message:**

> {Full message text, rendered in a grey preformatted box}

Message ID: {uuid}

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

Happy Hour Compass · Contact form notification

---

### CTA

| Field | Value |
|---|---|
| **Button** | None — the full message is rendered in the email body |
| **Secondary links** | None |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` — not visible in body (no button, no action steps) |
| **Sign-off** | None — operational notification only |

### Type

**Internal operational email** — recipient is the founder only.

---

---

## Email 4.2 — Contact Submitter Confirmation

| Field | Value |
|---|---|
| **Email name** | `contact_submitter_confirmation` |
| **Purpose** | Confirms to the visitor that their message was received |
| **Trigger** | Immediately after Email 4.1 succeeds (only sent if founder notification succeeded) |
| **Recipient** | Visitor (email they provided on the contact form) |
| **Sender** | `Happy Hour Compass <hello@happyhourcompass.com>` |
| **Reply-To** | None set |
| **Subject line** | `We got your message` |
| **Criticality** | `standard` |
| **Blocking / Non-blocking** | Non-blocking — failure is logged; the visitor already sees a success state |

---

### Rendered Email

---

**[Happy Hour Compass logo — centred, 110px wide]**

---

**We got your message**

Hi {Name},

Thanks for reaching out to Happy Hour Compass. We've received your message and will take a look shortly.

---

**What happens next?**

1. We'll read your message and get back to you as soon as we can.
2. You'll receive our reply at this email address.

---

**Keep an eye on your inbox**  
Our reply may land in your spam or junk folder. Please add **hello@happyhourcompass.com** to your contacts to make sure you don't miss it.

Cheers,  
**Wayne**  
Founder, Happy Hour Compass

---

**[Footer]**  
**Happy Hour Compass**  
Helping guests discover happy hours, specials, and events.  
[happyhourcompass.com](https://happyhourcompass.com) · [hello@happyhourcompass.com](mailto:hello@happyhourcompass.com)

You received this email because you submitted a message on Happy Hour Compass.

---

> Note: If the visitor did not provide a name, the greeting reads "Hi there,".

---

### CTA

| Field | Value |
|---|---|
| **Button** | None |
| **Secondary links** | None — recipient is told HHC will reply to this email |

---

### Branding

| Field | Value |
|---|---|
| **Logo** | HHC logo, centred, 110px wide |
| **Header style** | White card, logo in bordered header cell |
| **Footer style** | Standard shared footer |
| **Primary colour** | Amber `#d97706` ("What happens next?" step numbers, spam callout border) |
| **Sign-off** | **Wayne** / Founder, Happy Hour Compass |

### Type

**Customer confirmation** — purely transactional. No action required from recipient.

---

---

## Flow 4 Summary

### Emails Sent

| Phase | Email | Recipient |
|---|---|---|
| On form submission | Contact Founder Notification (4.1) | Founder |
| On form submission (after 4.1 succeeds) | Contact Submitter Confirmation (4.2) | Visitor |

### Emails NOT Sent

- No follow-up email from HHC if the founder responds directly (reply is manual from the founder's email client).

### Conditional Paths

```
Visitor submits contact form
  └─ Message inserted into DB
       └─ Contact Founder Notification sent (4.1) — BLOCKING
            ├─ SUCCESS: Contact Submitter Confirmation sent (4.2) — non-blocking
            └─ FAILURE: Error returned to visitor. Email 4.2 is NOT attempted.
```

---

---

# Appendix: Emails Outside Acquisition Flows

The following emails exist in `email.ts` but are **not** part of the four acquisition flows under review. Documented here for completeness.

| Email name | Function | Used in |
|---|---|---|
| `password_reset` | Operator self-service password reset | `src/app/forgot-password/actions.ts` |
| `member_invite` | Invites a team member to manage a venue | `src/app/admin/users/actions.ts` |
| `platform_admin_invite` | Invites a new Control Panel admin | `src/app/control-panel/platform-admins/actions.ts` |
| `venue_cancellation_founder` | Notifies founder when an operator cancels their venue | `src/app/admin/venue/cancelActions.ts` |
| `claim_approval_legacy` | Legacy claim approval (token-based `/activate-account` flow) | Still present in `email.ts`, not called by current actions |
| `claim_more_info_legacy` | Legacy claim more-info (reply-to-email approach, no token) | Still present in `email.ts`, not called by current actions |

---

---

# Observations

The following are factual observations only. No recommendations or suggested changes are included.

1. **Wayne is the named signer in four customer-facing emails** — Claim Submission Confirmation (3.2), Contact Us Confirmation (4.2), Submission Closed Notification (2.6), and the legacy Request More Info email (2.x legacy). He is not the signer in the account setup emails (2.2, 2.5, 3.5) or the more-info request emails (2.3, 3.3).

2. **Two emails are never sent to the customer-facing submitter in the Suggest a Venue flow** — the confirmation email (1.2) is conditional on the consumer providing their email address, which is an optional field on that form.

3. **Claim rejection sends no email to the claimant.** When a founder rejects a claim in the Control Panel, the claim record is updated to `rejected` but no email is sent to the claimant.

4. **Subject line patterns are inconsistent across flows:**
   - Claim approval: `Your Happy Hour Compass claim was approved — set up your password`
   - Activation: `Your venue is on Happy Hour Compass — set up your account`
   - Contact confirmation: `We got your message`
   - Claim receipt: `We received your claim — {Venue Name}`
   - Suggestion confirmation: `Thanks for your Happy Hour Compass suggestion`

5. **CTA button text is inconsistent between the two account setup emails:**
   - Claim approval (3.5): "Set up my password →"
   - Operator activation (2.2 / 2.5): "Set up my account →"
   Both emails perform the same action (password creation via Supabase recovery link) but use different button labels.

6. **The more-info emails for claims (3.3) and submissions (2.3) are near-identical in copy and structure.** The headline ("A few more details needed"), body paragraphs, "What happens next?" steps, spam callout, and link expiry (72 hours) are the same. The differences are the footer note wording and the URL path (`/claim/more-info/` vs `/suggest/owner/more-info/`).

7. **The "What happens next?" panel is absent from the Operator Activation emails (2.2, 2.5).** All other customer emails that involve a waiting period include this panel. The activation emails include only a button and an expiry note.

8. **The spam callout block is absent from the account setup emails (2.2, 2.5, 3.5) and the password reset email.** It is present in all customer emails where the recipient is waiting for a follow-up from HHC (suggestion confirmation, claim receipt, contact confirmation, more-info requests). The code comments in `email.ts` explicitly document this exclusion decision.

9. **No Reply-To header is set on any email.** Replies from recipients will go to `hello@happyhourcompass.com` (the From address). The closure email (2.6) and both more-info emails explicitly tell recipients to reply to that address.

10. **The Suggestion Founder Notification (1.1) is the only internal notification email with no CTA button.** All other founder notifications (claim, submission, info submitted) include a direct link to the relevant Control Panel review page.

11. **Different footer notes are used across the email groups:**
    - Customer emails related to suggestions: "You received this email because you suggested a venue on Happy Hour Compass."
    - Customer emails related to claims: "You received this email because you submitted a venue claim on Happy Hour Compass."
    - Customer emails related to submissions: "You received this email because you submitted a venue on Happy Hour Compass."
    - Customer emails related to contact: "You received this email because you submitted a message on Happy Hour Compass."
    - Internal/founder emails: "Happy Hour Compass · Control Panel notification" or "Happy Hour Compass · Consumer suggestion notification" or "Happy Hour Compass · Operator submission notification" or "Happy Hour Compass · Venue claim notification" or "Happy Hour Compass · Contact form notification"

12. **The Suggest a Venue confirmation (1.2) has no sign-off from Wayne**, while the Contact Us confirmation (4.2), Claim Submission Confirmation (3.2), and Submission Closed Notification (2.6) do include "Cheers, Wayne / Founder, Happy Hour Compass."

13. **Link expiry is inconsistent between account setup and more-info emails:**
    - Account setup links (2.2, 2.5, 3.5): 24 hours
    - More-info form links (2.3, 3.3): 72 hours

14. **Two legacy email functions remain in `email.ts`** — `sendApprovalEmail` (type: `claim_approval_legacy`) and `sendRequestMoreInfoEmail` (type: `claim_more_info_legacy`) — but are not called by any current action files. They appear to be superseded by `sendPasswordSetupEmail` and `sendClaimMoreInfoEmail` respectively.

15. **The `pending_review` and `double_claim` routing outcomes in the Operator Submission flow send only a founder notification.** Submitters in these states receive no email at any point after their initial on-screen success state, regardless of how long they wait.

16. **The Contact Founder Notification (4.1) is the only acquisition email that is blocking on behalf of the customer.** If it fails, the visitor sees an error and cannot complete the form. All other founder notifications are non-blocking.

17. **The Suggestion Confirmation (1.2) includes a marketing opt-in variant** that adds an additional paragraph acknowledging the opt-in and explaining how to opt out. No other customer-facing email in these four flows has a marketing opt-in variant.

18. **The greeting in customer emails uses the first name when available** ("Hi {First Name},") but falls back to "Hi there," (suggestion confirmation, contact confirmation) or "Hello {First Name}," (legacy more-info email) depending on the email. The legacy `sendRequestMoreInfoEmail` uses "Hello {First Name}," while all current emails use "Hi {First Name},".

19. **The logo renders from `{APP_URL}/logo.png`.** In local development, `APP_URL` is not set, so the logo URL falls back to `http://localhost:3000/logo.png` and will not render. In production and Vercel previews, the logo renders correctly.

20. **The status badge in the two Info Submitted notifications (2.4, 3.4) uses purple** (`#7c3aed`) while all CTA buttons use amber (`#d97706`). The founder notifications for initial submission (2.1) use colour-coded match status badges: green for `confirmed`, red for `rejected`, amber for `no_match`.

---

*End of document.*
