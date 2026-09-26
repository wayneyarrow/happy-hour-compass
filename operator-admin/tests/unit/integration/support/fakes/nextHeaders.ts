// Boundary fake for "next/headers" — the incoming browser request.
import { world } from "../world";

export async function headers() {
  return new Headers([...world.requestHeaders.entries()]);
}
export async function cookies() {
  return {
    get(name: string) {
      const c = world.cookies.get(name);
      return c ? { name, value: c.value } : undefined;
    },
    getAll() {
      return [...world.cookies.entries()].map(([name, c]) => ({ name, value: c.value }));
    },
    set(name: string, value: string, options?: Record<string, unknown>) {
      world.cookies.set(name, { value, options });
    },
  };
}
