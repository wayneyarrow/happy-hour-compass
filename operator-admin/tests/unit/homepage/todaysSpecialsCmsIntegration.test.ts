import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural regression coverage for the "no more title-based insertion"
 * requirement of the Today's Specials CMS/CPanel integration: Today's
 * Specials must be a real, saved Homepage Section resolved by
 * displayOrder like any other section — never a render-time special case
 * that finds a section literally titled "Patio Picks". These are file-
 * content assertions rather than logic assertions because the property
 * being guaranteed IS the absence of that code path.
 */

const OPERATOR_ADMIN_ROOT = join(__dirname, "../../..");

test("the temporary title-based placement helper file no longer exists", () => {
  assert.equal(existsSync(join(OPERATOR_ADMIN_ROOT, "src/lib/homepageSectionPlacement.ts")), false);
});

test("the public homepage page no longer imports or references the title-based placement helper", () => {
  const source = readFileSync(join(OPERATOR_ADMIN_ROOT, "src/app/(website)/page.tsx"), "utf8");
  assert.ok(!source.includes("homepageSectionPlacement"));
  assert.ok(!source.includes("splitHomepageSectionsForInsertion"));
  assert.ok(!source.includes("Patio Picks"));
});

test("the homepage sections renderer routes daily_special_collection sections to TodaysSpecialsSection", () => {
  const source = readFileSync(
    join(OPERATOR_ADMIN_ROOT, "src/app/(website)/homepage/HomepageSectionsRenderer.tsx"),
    "utf8"
  );
  assert.ok(source.includes("daily_special_collection"));
  assert.ok(source.includes("TodaysSpecialsSection"));
});

test("TodaysSpecialsSection is presentational — it receives a resolved section prop rather than fetching its own data", () => {
  const source = readFileSync(
    join(OPERATOR_ADMIN_ROOT, "src/app/(website)/homepage/TodaysSpecialsSection.tsx"),
    "utf8"
  );
  // Purely presentational components in this codebase are plain (non-async)
  // functions — CollectionRail.tsx and FeatureSection.tsx follow the same
  // convention. An `async function` here would mean it went back to
  // fetching its own data instead of rendering an already-resolved section.
  assert.ok(!source.includes("async function TodaysSpecialsSection"));
  assert.ok(source.includes("section.items"));
});
