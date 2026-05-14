# GitHub Issue Instructions

Use these instructions when the user asks to create or edit GitHub issues for Collasco.

## Defaults

- Write Collasco GitHub issues in English.
- Create Collasco GitHub issues in `tunubeya/qms-front` unless the user explicitly names another repository.
- Add new Collasco issues to GitHub Project `Collasco`: `https://github.com/users/tunubeya/projects/2/views/1`.
- Bug issues and small change issues must be added to the project and put in the `Todo` status column unless the user asks for another status.
- After creating a Collasco issue, verify that it appears in the `Collasco` project with the expected `Status` value before reporting it as done.

## Labels

- Bug issues and bug stories must receive the `bug` label.
- Small change issues must receive the `Small change` label.
- When the user describes a ticket as a small change, create it in `tunubeya/qms-front`, add it to the Collasco project, and put it directly in the `Todo` status column unless the user asks for another status.

## Bug Story Format

When the user describes the issue as a bug story, format the issue with:

```md
## Bug story

As a ..., I want ..., so that ...

## Problem

## Expected behavior

## Actual behavior

## Reproduction steps

## Acceptance criteria
```

## GitHub CLI Notes

- When creating or editing issue bodies with `gh`, use real multiline Markdown.
- Do not pass escaped `\n` sequences that render literally in GitHub.

