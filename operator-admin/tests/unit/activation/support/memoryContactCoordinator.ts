import { createSetupContactCoordinator, type SetupContactCoordinator } from "../../../../src/lib/activation/setupContactStore";
import { createFakeOperatorsContactClient, makeOperatorContactRow, type FakeOperatorContactRow } from "./fakeOperatorsContactClient";

/**
 * The REAL setup-contact store over an in-memory operators table that
 * provisions an (unactivated) row for any operator id on first use — for
 * tests whose own fakes don't model public.operators contact columns.
 */
export function createMemoryContactCoordinator(): { coordinator: SetupContactCoordinator; rows: FakeOperatorContactRow[] } {
  const rows: FakeOperatorContactRow[] = [];
  const fake = createFakeOperatorsContactClient(rows);
  const realFrom = fake.client.from.bind(fake.client);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fake.client.from = (table: string): any => {
    const t = realFrom(table);
    const realSelect = t.select.bind(t);
    return {
      ...t,
      select: (...args: unknown[]) => {
        const b = realSelect(...args);
        const realEq = b.eq.bind(b);
        b.eq = (col: string, val: unknown) => {
          if (col === "id" && typeof val === "string" && !rows.some((r) => r.id === val)) rows.push(makeOperatorContactRow({ id: val }));
          return realEq(col, val);
        };
        return b;
      },
    };
  };
  return { coordinator: createSetupContactCoordinator(fake.client), rows };
}
