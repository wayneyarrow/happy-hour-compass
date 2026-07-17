import type { SchemaGraph, SchemaNode } from "@/lib/seo/schema/types";

/**
 * Shared JSON-LD render component for the public website's structured data
 * foundation (see docs/website/ structured data strategy/architecture
 * reviews). Lives beside FaqAccordion.tsx rather than under
 * src/lib/seo/schema/ — this codebase consistently keeps rendering
 * components in src/app/ and pure logic in src/lib/, and FaqAccordion.tsx
 * (which already renders its own JSON-LD <script>) is the direct
 * precedent for that split.
 *
 * Accepts nodes rather than a pre-built graph so every schema builder can
 * simply return SchemaNode | null (see types.ts and the omission rules in
 * the structured data architecture review) without each caller having to
 * filter nulls itself. Renders nothing when every node is null/undefined
 * or the list is empty.
 *
 * @id references inside these nodes only resolve against other JSON-LD
 * present on the *same rendered page* — Google does not carry a node
 * looked up on one page over to another. A page's site-level graph (e.g.
 * Organization/WebSite, rendered once from (website)/layout.tsx) and its
 * page-level graph (rendered from the page itself) are two separate
 * <script> tags in one document, which is how a page-level node can
 * reference the site-level Organization by @id without redefining it.
 *
 * Uses the same JSON.stringify + dangerouslySetInnerHTML pattern already
 * established by FaqAccordion.tsx's own <script> tag, with one addition:
 * JSON.stringify does NOT escape '<', '>', or '/' — only quotes, backslashes,
 * and control characters. The HTML parser ends a <script> element the moment
 * it sees the literal byte sequence "</script" regardless of what produced
 * it, so once any of these nodes carries free text an operator or admin can
 * author (a venue name, event title, guide title — exactly what the
 * upcoming page-specific builders will feed in), an unescaped "</script>"
 * inside that text would prematurely close this tag and let whatever
 * follows in the string be parsed as live HTML. Escaping '<' to its JSON
 * unicode-escape equivalent breaks up that byte sequence while leaving the
 * parsed JSON value identical (< decodes back to '<'), so this is a
 * correctness fix, not a lossy one.
 */

type Props = {
  nodes: (SchemaNode | null | undefined)[];
};

export function JsonLd({ nodes }: Props) {
  const graph = nodes.filter((node): node is SchemaNode => node != null);
  if (graph.length === 0) return null;

  const payload: SchemaGraph = { "@context": "https://schema.org", "@graph": graph };
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
