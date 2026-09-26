// Minimal "next/navigation" for server-rendering client components in tests.
export function useRouter() {
  return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} };
}
export function redirect(url: string): never {
  throw new Error(`NEXT_REDIRECT ${url}`);
}
export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}
