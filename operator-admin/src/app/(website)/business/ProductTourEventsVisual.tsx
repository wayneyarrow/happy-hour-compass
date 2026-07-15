/**
 * Tab 3 ("Promote Events") visual for the business page's product tour.
 * business-page-event-1.png is a wide two-panel screenshot (event list +
 * event editor side by side) — no single crop window can show both the
 * list and the full editor at a readable scale in a square frame, because
 * `object-fit` can only ever crop one axis and show the other at its full
 * native extent. So, same pattern as the Happy Hours composite: stack two
 * independent windows onto the SAME source file instead — the event list
 * on top (heading, filters, both rows, Draft/Published badges), an
 * enlarged crop of the Trivia Tuesday editor below (name, type, details,
 * teaser, event image). Preview/Delete event and the mostly-empty right
 * edge of the wide input fields are cropped away — they don't carry the
 * story.
 *
 * Each window is drawn with a plain CSS background-image rather than
 * next/image's `fill`+`object-fit`, because `object-fit` can't select an
 * arbitrary interior rectangle (it always keeps one full axis). Sizing a
 * background image with independent width/height percentages — matched to
 * a container whose own aspect ratio equals the chosen crop's aspect
 * ratio, so nothing distorts — reproduces an exact crop window instead.
 * Same technique, still CSS-only positioning of the one existing asset;
 * no pixels are edited or merged.
 *
 * The two windows hand off at y≈360 in the source — right where the event
 * list card ends and just before the "Event details" label begins — so
 * the list (with both rows fully visible) and the editor's labelled
 * fields both survive the cut with only a few px of harmless overlap.
 * Event name/Event type aren't shown as separate fields (there isn't
 * height budget left for them once Event details/Teaser/Event image get
 * a readable size), but the selected event's name is already carried by
 * the highlighted "Trivia Tuesday" row in the list above.
 */

const SOURCE_URL = "url(/images/business/business-page-event-1.png)";

export function ProductTourEventsVisual() {
  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      {/* Top: event list — source crop x:[0,700] y:[0,364] of the
          1637x829 screenshot (heading, filters, Trivia Tuesday + Comedy
          After Dark rows with their Draft/Published badges). Container
          aspect from flex-[52] is 700/364. */}
      <div
        className="flex-[52] min-h-0 bg-no-repeat"
        style={{
          backgroundImage: SOURCE_URL,
          backgroundSize: "233.9% 227.7%",
          backgroundPosition: "0% 0%",
        }}
        role="img"
        aria-label="Events list in Operator Admin showing Trivia Tuesday (draft) and Comedy After Dark (published)"
      />
      <div className="border-t border-gray-100" />
      {/* Bottom: enlarged Trivia Tuesday editor — source crop x:[680,1637]
          y:[356,815] (event details, teaser, event image), matching the
          flex-[48] container's 957/459 aspect. */}
      <div
        className="flex-[48] min-h-0 bg-no-repeat"
        style={{
          backgroundImage: SOURCE_URL,
          backgroundSize: "171.1% 180.6%",
          backgroundPosition: "100% 96.2%",
        }}
        role="img"
        aria-label="Trivia Tuesday event editor showing event details, teaser, and event image fields"
      />
    </div>
  );
}
