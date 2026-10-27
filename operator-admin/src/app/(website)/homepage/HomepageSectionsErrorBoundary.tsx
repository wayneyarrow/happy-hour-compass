"use client";

import * as Sentry from "@sentry/nextjs";
import { Component, type ReactNode } from "react";

/**
 * Last-resort boundary around the homepage's streamed editorial Sections
 * ((website)/page.tsx). Individual Section failures are already isolated
 * where they resolve (resolvePublicHomepageSections); this only catches a
 * failure shared by all of them — e.g. an exception while rendering the
 * resolved Sections. Without it, such an error would reach the global
 * error page and replace the already-visible header and hero; with it the
 * visitor keeps the header, hero and footer, and the error is reported.
 *
 * Renders nothing on error: no partial or misleading editorial content.
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
    return this.state.failed ? null : this.props.children;
  }
}
