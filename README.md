# openclaw-soul

OpenClaw skill providing a `/soul` command to browse and apply curated `SOUL.md` personas from a machine-readable catalog.

## Goals

- native-feeling `/soul` command for OpenClaw
- browse catalog by category rather than dumping a huge flat list
- apply a selected remote `SOUL.md` into the current workspace
- keep visible backups and local provenance metadata
- default to the `awesome-openclaw-agents` catalog, while allowing a configurable alternate catalog URL later

## MVP commands

- `/soul`
- `/soul categories`
- `/soul list <category>`
- `/soul show <id>`
- `/soul apply <id>`
- `/soul current`
- `/soul restore`
- `/soul search <text>`

## Storage

Workspace-local state is kept in:

- `soul-data/cache/agents.json`
- `soul-data/backups/SOUL-<timestamp>.md`
- `soul-data/state.json`

## Default catalog

Default upstream catalog:

- <https://raw.githubusercontent.com/mergisi/awesome-openclaw-agents/refs/heads/main/agents.json>

## Notes

This skill applies only `SOUL.md` in the MVP. It does not currently swap `AGENTS.md`, `HEARTBEAT.md`, or other workspace files.
