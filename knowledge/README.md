# Public knowledge corpus

Reviewed source documents for retrieval (ADR-031, ADR-053). Treat every file as publicly readable. Do not include phone numbers, private addresses, credentials, confidential notes, or unverified claims.

## File format

Markdown with this frontmatter (all keys required except `url`):

```
---
id: short-stable-id
title: Human readable title
kind: experience | project | skill | education | faq
lang: en
updated: 2026-10-04
url: https://github.com/example/repo
reviewed: true
---
```

- `id` is lowercase letters, digits, and hyphens, 3 to 64 characters, and unique. It becomes part of every chunk id, so renaming it changes citations.
- Use `##` and `###` headings for sections. No `#` heading, no raw HTML, no literal `[1]` style markers.
- `url` is optional, https only, on an allowlisted host.
- Write short factual sentences. Chunks are at most 600 characters and the chunk text is shown to visitors as the citation excerpt.

## Review checklist (per file)

- [ ] Every claim is true and verifiable; nothing invented or rounded up.
- [ ] No phone number, home address, private email, credential, or confidential detail.
- [ ] Links are public and intended to be shown.
- [ ] `reviewed: true` is set only after the owner has read the whole file.
