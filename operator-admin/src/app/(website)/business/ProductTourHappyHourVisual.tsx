import Image from "next/image";

/**
 * Tab 2 ("Update Happy Hours") visual for the business page's product tour.
 * The three source screenshots (Happy Hour Times, Food Specials, Drink
 * Specials) don't share an aspect ratio and don't fit one browser
 * viewport, so this composes them into a single restrained layout instead:
 * Happy Hour Times dominant on top (the primary editor), Food and Drink
 * Specials as smaller supporting crops below — real Operator Admin pixels
 * throughout, cropped and scaled via CSS only (no re-created UI, no
 * altered text). Renders inside BrowserMockFrame's aspect-square content
 * area as `visual`, replacing the single-image slot for this slide only.
 */
export function ProductTourHappyHourVisual() {
  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <div className="relative flex-[62] min-h-0 overflow-hidden">
        <Image
          src="/images/business/business-page-hh-times-1.png"
          alt="Happy Hour Times editor in Operator Admin showing daily happy hour schedules with start and end times for each day of the week"
          fill
          className="object-cover object-top"
        />
      </div>
      <div className="flex flex-[38] min-h-0 border-t border-gray-100">
        <div className="relative flex-1 min-w-0 overflow-hidden border-r border-gray-100">
          <Image
            src="/images/business/business-page-food-specials-1.png"
            alt="Food specials editor in Operator Admin listing item names and prices"
            fill
            className="object-cover object-left-top"
          />
        </div>
        <div className="relative flex-1 min-w-0 overflow-hidden">
          <Image
            src="/images/business/business-page-drink-specials-1.png"
            alt="Drink specials editor in Operator Admin listing item names and prices"
            fill
            className="object-cover object-left-top"
          />
        </div>
      </div>
    </div>
  );
}
