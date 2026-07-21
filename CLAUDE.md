# Road Network Editor - Project Instructions

Rules for working in this repo. Durable rules only, not a map of the codebase.

**For what this is, how to run it, and how to prepare data, read
[README.md](README.md) first**, then the focused doc in [docs/](docs/):

| Question | Doc |
|---|---|
| Which road/shelter inputs are needed and where they go | [docs/DATA_SETUP.md](docs/DATA_SETUP.md) |
| Connecting the MCP server | [docs/MCP_SETUP.md](docs/MCP_SETUP.md) |
| Reference data layout | [docs/REFERENCE_DATA.md](docs/REFERENCE_DATA.md) |
| Scenario optimizer behavior | [docs/SCENARIO_OPTIMIZER.md](docs/SCENARIO_OPTIMIZER.md) |

Do not turn this file into a second index.

---

## This repo is public

`xyver/road-network-editor` is world-readable. Keep internal planning,
business docs, credentials, and operational runbooks out of it.

---

## Standalone by design

The active code (`app/`, `scripts/`, `mcp_server/`) does **not** import Python
or JavaScript from DaedalMap or County Map. It consumes their prepared
artifacts as explicit inputs - Docker mounts and CLI paths
(`ROAD_EDITOR_OSM_DIR`, `ROAD_EDITOR_SOURCE_DATA_DIR`, `ROAD_EDITOR_DATA_DIR`,
`--geometry-root`) - so this repo can stand alone without code surgery.

That independence is the point. Do not add an import, a relative path, or a
`sys.path` entry reaching into `county-map/` or `county-map-private/`. If this
repo needs something from those, it arrives as an input artifact.

Known exception: `legacy/road_access/` predates the split and still bootstraps
into the private repo (`path_bootstrap`, `ensure_private_build_paths`,
`PUBLIC_ROOT`). It will not run from a standalone checkout. Treat it as
reference only - do not extend it, and do not copy its path wiring into active
code.

---

## Serialization: plain JSON

This repo uses ordinary JSON. The MessagePack rule from the sibling DaedalMap
repos does **not** apply here - do not port `msgpack_response()` or
`fetchMsgpack()` patterns into this codebase.

---

## Scenario model

The regional graph is never overwritten. A scenario stores only a mapping of
`segment_id -> state`:

```
open -> forward_only -> reverse_only -> closed -> open
```

`forward` and `reverse` refer to the direction the segment geometry is stored
and drawn in, not compass direction. Preserve that contract when touching
scenario code - rewriting the base graph instead of layering state is the
regression to avoid.

Put new work in `app/`, `scripts/`, or `mcp_server/`, never in `legacy/`.

---

## Encoding

Plain alphanumerics and basic punctuation only - in code, comments, docs, and
commit messages. No emoji, box-drawing, arrows, checkmarks, or smart quotes.
They cause encoding failures on this Windows setup.

Line endings are LF, enforced by `.gitattributes`. When writing files from
Python, note that `Path.write_text()` converts `\n` to `\r\n` on Windows and
will rewrite every line of an LF file. Use `write_bytes()` or `newline=''`.

---

## Windows environment

Development is on Windows and the README commands assume PowerShell. No `&&`;
chain with `;`. The Bash tool is Git Bash and uses POSIX syntax - pick one
shell per command and write it correctly for that shell.

Prefer the dedicated tools over shell commands for file work, since they
handle Windows paths without quoting problems:

1. **Glob** - find files by pattern
2. **Read** - read a file
3. **Grep** - search file contents
4. **Shell** - only when no tool fits

This project runs in Docker. Prefer `docker compose` over ad-hoc local Python
runs so the graph build matches what the app serves.

---

## Git workflow

- committing is fine - organize work into small, clear commits
- **never push** - the user does all pushing, on every repo
- keep commit messages short; no co-authored trailer
- prefer a branch over committing straight to `main`

## Communication style

Speak like a capable teammate giving a useful handoff, not a browser assistant
announcing work.

- Lead with the result, blocker, or decision in plain language.
- Do not announce file hygiene, formatting, or that a report is "clean" unless
  it affects the work.
- Avoid theatrical framing: "the through-line," "if you only read three
  things," "I'd flag," "genuinely," and self-congratulatory status language.
- For audits, state: confirmed problem, evidence, impact, recommended next
  action, and any real decision needed.
- Use headings and tables only when they make a decision easier. Do not add
  structure for the appearance of completeness.
- Be direct, specific, and conversational. No marketing voice or generic AI
  summary language.
