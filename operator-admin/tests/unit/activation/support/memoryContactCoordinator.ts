import { createSetupContactCoordinator, type SetupContactCoordinator } from "../../../../src/lib/activation/setupContactStore";
import { createFakeOperatorsContactClient, makeOperatorContactRow, type FakeOperatorContactRow } from "./fakeOperatorsContactClient";

/**
 * The REAL setup-contact store over an in-memory operators table that
 * provisions an (unactivated) row for any operator id on first use — for
 * tests whose own fakes don't model public.operators contact columns.
 *
 * Claims are stamped with the later of the caller's `now` and the coordinator's
 * clock (the wall clock in production). Tests pin that clock to the epoch so
 * stamps follow the test's own fixed `now` — otherwise every fixed-date test
 * silently changes behaviour once the real date passes it.
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
  return { coordinator: createSetupContactCoordinator(fake.client, { clock: () => new Date(0) }), rows };
}
