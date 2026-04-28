# Instructions

Always use descriptive commits that name the actual subject of the change.

## MCP

Never alter live Collasco project contents through MCP unless the target project is exactly `Collasco Automated E2E Testsuite`. Treat every other project as read-only unless the user explicitly names that project and asks for a mutation.

## Collasco Documentation

Before changing documentation in Collasco, first show the exact proposed content and ask for approval. Minor Collasco documentation edits may be applied directly only when they fix typos, grammar, formatting, readability, or minor rewording without materially changing the meaning. Ask for approval before making substantive Collasco documentation changes.

Do not create a separate `Overview` feature just to describe a Collasco module. Put general module-level overview content in the module's own `Overview` documentation field. Create features only for distinct functional areas, workflows, or implementation units.

Collasco documentation content must be written as supported HTML fragments, not Markdown. Supported tags include bold, italic, underline, numbered and unnumbered lists, code, and preformatted text.

Format Collasco documentation for readability: use short paragraphs, leave blank lines between logical blocks in proposed HTML source for review, and prefer proper `<ul>`, `<ol>`, `<li>`, `<code>`, and `<pre>` blocks instead of dense inline text. Do not rely on source whitespace being preserved after saving in Collasco; Collasco serializes content as compact HTML. For visible blank lines, insert explicit empty paragraphs (`<p></p>`). When writing lists, match the Collasco editor style by wrapping each list item in a paragraph, for example `<ul><li><p>Item text</p></li></ul>`.
