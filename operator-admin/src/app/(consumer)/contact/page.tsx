import Link from "next/link";
import { ContactForm } from "./ContactForm";

export const metadata = { title: "Contact Us" };

export default function ContactPage() {
  return (
    <main className="bg-white">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex items-center px-5 py-4">
        <Link
          href="/suggest"
          className="text-blue-500 text-[24px] font-bold leading-none mr-3"
          aria-label="Back"
        >
          ‹
        </Link>
        <h1 className="flex-1 text-[18px] font-bold text-gray-900 truncate">
          Contact Us
        </h1>
      </div>
      <ContactForm />
    </main>
  );
}
