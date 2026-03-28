---
name: soul
description: Browse categories, preview, apply, and restore OpenClaw SOUL.md personas from a curated remote catalog. Use for /soul categories, /soul list <category>, /soul show <id>, /soul apply <id>, /soul current, /soul restore, and /soul search <text>.
user-invocable: true
command-dispatch: tool
command-tool: exec
command-arg-mode: raw
metadata:
  { "openclaw": { "requires": { "bins": ["node"] } } }
---

# soul

Dispatch this command directly to the local helper script.

Run:

```bash
node {baseDir}/scripts/soul.mjs "{{raw_args}}"
```

Behavior:

- `categories` → list categories with counts
- `list <category>` → list souls in a category
- `show <id>` → preview a soul
- `apply <id>` → back up current `SOUL.md`, fetch selected soul, and write it into the workspace
- `current` → show current applied soul metadata if known
- `restore` → restore the most recent backup
- `search <text>` → fuzzy-ish search across ids/categories/names

Safety rules:

- Only trust the configured catalog URL and raw GitHub content derived from its entries.
- Never overwrite `SOUL.md` without first creating a backup in `soul-data/backups/`.
- Write provenance metadata to `soul-data/state.json`.
- After apply/restore, tell the user to start a new session or use `/new` for full effect.
