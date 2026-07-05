/**
 * jsonLd.ts, safe serializer for JSON-LD injected via
 * dangerouslySetInnerHTML into a <script type="application/ld+json"> tag.
 *
 * JSON.stringify does NOT escape `<`, `>`, `&`, or the string `</script>`,
 * so any attacker-controlled value that reaches the payload (notably a
 * contract/token LABEL, which can be an on-chain ERC-20 name like
 * `</script><script>...</script>`) would break out of the script tag and
 * execute. This is a known XSS vector against block explorers.
 *
 * Escaping `<` alone stops the `</script>` breakout (ld+json is parsed as
 * text, not executed as JS); we also escape `>` and `&` for good measure.
 * Use this instead of JSON.stringify for every ld+json block.
 */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
