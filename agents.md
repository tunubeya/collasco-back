# Instructions

Always use descriptive commits that name the actual subject of the change.

## GitHub

When writing multi-line text to GitHub issues, comments, pull requests, or project items, use real line breaks. Do not write escaped newline sequences like `\n` into user-facing GitHub content.

## MCP

Never alter live Collasco project contents through MCP unless the target project is exactly `Collasco Automated E2E Testsuite`. Treat every other project as read-only unless the user explicitly names that project and asks for a mutation.

## Collasco Documentation

Before changing documentation in Collasco, first show the exact proposed content and ask for approval. Minor Collasco documentation edits may be applied directly only when they fix typos, grammar, formatting, readability, or minor rewording without materially changing the meaning. Ask for approval before making substantive Collasco documentation changes.

Before drafting or changing Collasco documentation, read the project's documentation labels. Use the label definitions to know which sections exist, which sections are mandatory, and what instructions each section provides.

Do not create a separate `Overview` feature just to describe a Collasco module. Put general module-level overview content in the module's own `Overview` documentation field. Create features only for distinct functional areas, workflows, or implementation units.

Do not create a Collasco feature for information that fits an existing documentation label on a module or feature. Before creating a feature, read the project's documentation labels and use the available labels where they fit. Collasco also contains label reference documentation; consult https://collasco.com/public/manual/shared/4fd19cab-cfee-4aba-81a8-828904c44104 when deciding whether something belongs in a label or in a feature. Create a feature only when it represents distinct functionality, behavior, workflow, or implementation scope.

Avoid overlap between Collasco documentation sections. Use each section for a distinct purpose, and do not fill every available section by default. Only mandatory documentation sections must always be completed; optional sections should be used only when they add non-duplicative value.

Describe current or desired behavior directly, without normative language. Avoid wording like `must`, `should`, or `needs to` when documenting behavior; use descriptive phrasing such as `does`, `uses`, `runs`, or `is intended to`.

Collasco documentation content must be written as supported HTML fragments, not Markdown. Supported tags include bold, italic, underline, numbered and unnumbered lists, code, and preformatted text.

Format Collasco documentation for readability: use short paragraphs, leave blank lines between logical blocks in proposed HTML source for review, and prefer proper `<ul>`, `<ol>`, `<li>`, `<code>`, and `<pre>` blocks instead of dense inline text. Do not rely on source whitespace being preserved after saving in Collasco; Collasco serializes content as compact HTML. For visible blank lines, insert explicit empty paragraphs (`<p></p>`). When writing lists, match the Collasco editor style by wrapping each list item in a paragraph, for example `<ul><li><p>Item text</p></li></ul>`.
