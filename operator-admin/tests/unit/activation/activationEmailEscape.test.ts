import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "../../../src/lib/activation/activationEmailEscape";

test("escapes all five characters that matter for HTML text-node safety", () => {
  assert.equal(escapeHtml("&"), "&amp;");
  assert.equal(escapeHtml("<"), "&lt;");
  assert.equal(escapeHtml(">"), "&gt;");
  assert.equal(escapeHtml('"'), "&quot;");
  assert.equal(escapeHtml("'"), "&#39;");
});

test("a script tag is neutralized into inert text, not a real element", () => {
  const escaped = escapeHtml('<script>alert("x")</script>');
  assert.equal(escaped, "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.doesNotMatch(escaped, /<script>/i);
});

test("a value that closes an attribute and injects a new one is neutralized", () => {
  const escaped = escapeHtml('" onmouseover="alert(1)');
  assert.doesNotMatch(escaped, /"/, "no raw quote survives to close an attribute");
  assert.equal(escaped, "&quot; onmouseover=&quot;alert(1)");
});

test("ampersands in ordinary business names are escaped without double-escaping already-escaped entities", () => {
  assert.equal(escapeHtml("Pub <North> & \"Friends\""), "Pub &lt;North&gt; &amp; &quot;Friends&quot;");
});

test("an apostrophe in a real venue/operator name is escaped", () => {
  assert.equal(escapeHtml("O'Reilly & Sons"), "O&#39;Reilly &amp; Sons");
});

test("a string with none of the five characters is returned unchanged", () => {
  assert.equal(escapeHtml("Buffalo Rouge Brewing Co."), "Buffalo Rouge Brewing Co.");
});

test("empty string passes through unchanged", () => {
  assert.equal(escapeHtml(""), "");
});
