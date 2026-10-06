# Prompts

Versioned prompt files for the AI features. **Phase 1 contains stubs only — no production prompt text.**

```
config/prompts/<prompt-id>/v<semver>.md
```

Each file starts with front matter:

| Field                         | Meaning                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `id`                          | Prompt id (matches the folder)                                      |
| `version`                     | Semantic version (matches the file name)                            |
| `status`                      | `stub` → `draft` → `approved` → `retired`                           |
| `model_slot`                  | `conversation` or `extraction` (mapped to a model id by env config) |
| `purpose`                     | One line describing what the prompt is for                          |
| `owner`                       | Person responsible for the content                                  |
| `approved_by` / `approved_at` | Required before `status: approved`                                  |

Rules:

- The loader (`src/lib/prompts.ts`) only serves prompts with `status: approved`. Stubs and drafts throw.
- Approved versions are never edited in place. Changes create a new version file and a registry update in `registry.ts`.
- Every AI message records the prompt id and version that produced it (Phase 3).
- Prompt changes require the AI evaluation suite to pass (Phase 3) and compliance sign-off.
