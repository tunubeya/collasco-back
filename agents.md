# Instructions

Use the Collasco general instructions exposed by MCP as the canonical operating guide for working with Collasco.

Prefer the `collasco://instructions/general` MCP resource. If resources are unavailable in the client, use the `collasco_get_general_instructions` tool.

Collasco documents itself in Collasco as a project named `Collasco`. Use the available Collasco MCP server to find that project, inspect its structure, and read its labels and documentation.

Before working with Collasco content, read the shared `Instructions` manual for general Collasco guidance. Then use MCP to read the target project's labels and documentation before drafting or changing that project.

Never mutate live Collasco project contents unless the user explicitly names the target project and asks for a mutation. Automated MCP tests and exploratory write calls use the `Collasco Automated E2E Testsuite` project.

## GitHub issues

When the user asks to create a GitHub issue for Collasco, write the issue in English.

Use `tunubeya/collasco-back` as the default repository unless the user names another repository.

When creating or editing issue bodies with `gh`, use real multiline Markdown. Do not pass escaped `\n` sequences that render literally in GitHub.

If the user describes the issue as a bug story, format it with a `## Bug story` section using "As a ..., I want ..., so that ...", followed by problem, expected behavior, actual behavior, reproduction steps, and acceptance criteria.

Bug issues and bug stories must receive the `bug` label.

Add new Collasco issues to GitHub Project `Collasco`: `https://github.com/users/tunubeya/projects/2/views/1`. Bug issues must be added to the project and put in the `Todo` status column unless the user asks for another status.

After creating a Collasco issue, verify that it appears in the `Collasco` project with the expected `Status` value before reporting it as done.
