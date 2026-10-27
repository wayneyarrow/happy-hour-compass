"use client";

import * as Sentry from "@sentry/nextjs";
import { Component, type ReactNode } from "react";
import { HomepageBrowseLinks } from "./HomepageBrowseLinks";

/**
 * Last-resort boundary around the homepage's streamed editorial Sections
 * ((website)/page.tsx). Individual Section failures are already isolated
 * where they resolve (resolvePublicHomepageSections); this only catches a
 * failure shared by all of them — e.g. an exception while rendering the
 * resolved Sections. Without it, such an error would reach the global
 * error page and replace the already-visible header and hero; with it the
 * visitor keeps the header, hero and footer, and the error is reported.
 *
 * On error it shows the browse links instead: no partial or misleading
 * editorial content, but still a way into the site. This also covers a
 * response that is cut off before the Sections arrive (the client then
 * fails to render them).
 */
export class HomepageSectionsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    Sentry.captureException(error, { tags: { flow: "public-homepage", stage: "sections-render" } });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="py-10 md:py-12 border-t border-gray-100">
        <HomepageBrowseLinks />
      </section>
    );
  }
}
