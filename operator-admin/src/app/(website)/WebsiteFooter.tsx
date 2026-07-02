"use client";

import { useState } from "react";
import Link from "next/link";
import { AcquisitionModal } from "./acquisition/AcquisitionModal";
import { ContactUsModalContent } from "./acquisition/ContactUsModalContent";

export function WebsiteFooter() {
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <>
      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div>
              <p className="text-sm font-bold text-gray-900">
                Happy Hour <span className="text-amber-500">Compass</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Find the best happy hours near you.
              </p>
            </div>
            <div className="flex items-center gap-6">
              <Link
                href="/suggest/owner"
                className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
              >
                List your venue
              </Link>
              <Link
                href="/login"
                className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
              >
                Operator login
              </Link>
              <button
                type="button"
                onClick={() => setContactOpen(true)}
                className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
              >
                Contact Us
              </button>
            </div>
          </div>
          <p className="mt-8 text-xs text-gray-400">
            © {new Date().getFullYear()} Happy Hour Compass. All rights reserved.
          </p>
        </div>
      </footer>

      <AcquisitionModal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title="Contact Us"
        description="Have a question or feedback? We'd love to hear from you."
      >
        <ContactUsModalContent onDone={() => setContactOpen(false)} />
      </AcquisitionModal>
    </>
  );
}
