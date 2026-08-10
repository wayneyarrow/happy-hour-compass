import * as path from "path";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MARKET_ID = "39083a78-532d-4628-b2cb-d8e6618a15c2"; // Central Okanagan
const KELOWNA_CITY_ID = "13fe3ede-55db-41a7-a8f6-20d94e62445a";

function formatPhoneForStorage(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

type DayHours = { open: string; close: string } | null;
type BusinessHours = Record<string, DayHours>;

const venues = [
  {
    name: "Erica Jane",
    slug: "erica-jane",
    address_line1: "1187 Sunset Drive",
    city: "Kelowna",
    region: "BC",
    postal_code: "V1Y 9W7",
    country: "CA",
    lat: 49.894123,
    lng: -119.4947204,
    phone: formatPhoneForStorage("+1 778-214-9336"),
    website_url: "http://www.erica-jane.com/",
    place_id: "ChIJheGmUsnzfVMRPAA1ylRH2w8",
    google_rating: 4.3,
    google_review_count: 621,
    google_primary_type: "steak_house",
    google_types: [
      "steak_house", "seafood_restaurant", "restaurant", "food", "point_of_interest", "establishment",
    ],
    google_maps_uri: "https://maps.google.com/?cid=1142585359963848764",
    business_hours: {
      sunday: { open: "11:00", close: "23:00" },
      monday: { open: "11:00", close: "23:00" },
      tuesday: { open: "11:00", close: "23:00" },
      wednesday: { open: "11:00", close: "23:00" },
      thursday: { open: "11:00", close: "23:00" },
      friday: { open: "11:00", close: "23:00" },
      saturday: { open: "11:00", close: "23:00" },
    } as BusinessHours,
    google_business_hours:
      "Monday: 11:00 AM – 11:00 PM | Tuesday: 11:00 AM – 11:00 PM | Wednesday: 11:00 AM – 11:00 PM | " +
      "Thursday: 11:00 AM – 11:00 PM | Friday: 11:00 AM – 11:00 PM | Saturday: 11:00 AM – 11:00 PM | " +
      "Sunday: 11:00 AM – 11:00 PM",
    hh_times:
      "Monday: All Day\nTuesday: 2 PM – 5 PM\nWednesday: 2 PM – 5 PM, 9 PM – 11 PM\nThursday: 2 PM – 5 PM\n" +
      "Friday: 2 PM – 5 PM\nSaturday: 2 PM – 5 PM\nSunday: 2 PM – 5 PM, 9 PM – 11 PM",
    hh_food_details: JSON.stringify([
      { name: "Erica Jane Signature Fries", price: "10" },
      { name: "6 Oysters", price: "15" },
      { name: "Elevation Burger & Fries", price: "22" },
    ]),
    hh_drink_details: JSON.stringify([
      { name: "House Pint", price: "6", notes: "20 oz" },
      { name: "House Wine", price: "6", notes: "5 oz" },
      { name: "Nitro Espresso Martini", price: "10", notes: "2 oz" },
    ]),
  },
  {
    name: "Frankie We Salute You",
    slug: "frankie-we-salute-you",
    address_line1: "1717 Harvey Avenue",
    city: "Kelowna",
    region: "BC",
    postal_code: "V1Y 0L5",
    country: "CA",
    lat: 49.881350499999996,
    lng: -119.45972250000001,
    phone: formatPhoneForStorage("+1 236-420-3338"),
    website_url: "http://www.frankiewesaluteyou.com/",
    place_id: "ChIJ2w6bXKmNfVMRN09EsDXhVaY",
    google_rating: 4.8,
    google_review_count: 1133,
    google_primary_type: "vegetarian_restaurant",
    google_types: [
      "vegetarian_restaurant", "bar", "restaurant", "food", "point_of_interest", "establishment",
    ],
    google_maps_uri: "https://maps.google.com/?cid=11985733604023226167",
    business_hours: {
      sunday: { open: "11:00", close: "19:30" },
      monday: { open: "11:00", close: "14:00" },
      tuesday: { open: "11:00", close: "20:30" },
      wednesday: { open: "11:00", close: "20:30" },
      thursday: { open: "11:00", close: "20:30" },
      friday: { open: "11:00", close: "21:00" },
      saturday: { open: "11:00", close: "21:00" },
    } as BusinessHours,
    google_business_hours:
      "Monday: 11:00 AM – 2:00 PM | Tuesday: 11:00 AM – 8:30 PM | Wednesday: 11:00 AM – 8:30 PM | " +
      "Thursday: 11:00 AM – 8:30 PM | Friday: 11:00 AM – 9:00 PM | Saturday: 11:00 AM – 9:00 PM | " +
      "Sunday: 11:00 AM – 7:30 PM",
    hh_times:
      "Tuesday: 3 PM – 5 PM\nWednesday: 3 PM – 5 PM\nThursday: 3 PM – 5 PM\nFriday: 3 PM – 5 PM\n" +
      "Saturday: 3 PM – 5 PM\nSunday: 3 PM – 5 PM",
    hh_food_details: JSON.stringify([
      { name: "Nashville Hot & Sticky Cauliflower Wings", price: "12" },
      { name: "Sweet Corn Queso", price: "15" },
      { name: "Burrata", price: "18" },
    ]),
    hh_drink_details: JSON.stringify([
      { name: "All Beers", price: "6", notes: "18 oz" },
      { name: "All Bubbles, Rosé & White Wines", price: "6", notes: "5 oz" },
      { name: "All Margaritas", price: "10", notes: "1.5 oz" },
    ]),
  },
];

async function main() {
  for (const v of venues) {
    const insert = {
      name: v.name,
      slug: v.slug,
      address_line1: v.address_line1,
      city: v.city,
      region: v.region,
      postal_code: v.postal_code,
      country: v.country,
      lat: v.lat,
      lng: v.lng,
      phone: v.phone,
      website_url: v.website_url,
      place_id: v.place_id,
      google_rating: v.google_rating,
      google_review_count: v.google_review_count,
      google_primary_type: v.google_primary_type,
      google_types: v.google_types,
      google_maps_uri: v.google_maps_uri,
      business_hours: v.business_hours,
      google_business_hours: v.google_business_hours,
      hh_times: v.hh_times,
      hh_times_needs_review: false,
      hh_food_details: v.hh_food_details,
      hh_drink_details: v.hh_drink_details,
      establishment_type: "Restaurant and Bar",
      market_id: MARKET_ID,
      city_id: KELOWNA_CITY_ID,
      source: "seed",
      is_published: true,
    };

    const { data, error } = await supabase.from("venues").insert(insert).select("id,name,slug").single();
    if (error) {
      console.error(`FAILED creating ${v.name}:`, error.message);
    } else {
      console.log(`Created ${data.name} -> id=${data.id} slug=${data.slug}`);
    }
  }
}
main();
