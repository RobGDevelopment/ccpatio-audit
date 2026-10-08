# TRACKS.md | Execution tracks

A missing `.cursor/phase.lock` is Track 1. A present lock is Track 2. The lock is written only by `node .cursor/skills/phase-lock/scripts/write-lock.mjs`.

## Track 1 — Surgical

No `.cursor/phase.lock`. The run is bounded by explicit `@` file tags in the prompt (`@path/to/file.ts` or `@file.ts`).

`.cursor/hooks/pre-tool-scope.mjs` reads prompt context from stdin `prompt` / `user_prompt`, from file attachments, and from the latest user message at `transcript_path`.

- No `@` file tag: `Write`, `StrReplace`, and `Delete` are denied.
- Tags present: those tools may change only a path that equals a tag or ends with `/${tag}`. A tag that ends in `/` allows that directory.
- A tag must contain `/` or a lettered extension (`.md`, `.mjs`, `.ts`). `@README` and bare words are not file tags.
- A basename tag matches every file of that name. Use a repo-relative path when names collide.
- `wrap.mjs` does not filter commands on this track. There is no allow-list to compare against.

## Track 2 — Phased build

`.cursor/phase.lock` is present. File tools may change only `allowed_files`. An empty `allowed_files` list denies `Write`, `StrReplace`, and `Delete`.

Shell commands go through:

```bash
node .cursor/skills/scope-exec/scripts/wrap.mjs -- <command>
```

`write-lock.mjs` validates the packet against `.cursor/protocol/PHASE_PACKET.schema.json`, then:

- runs `git status --porcelain` and refuses a dirty worktree unless `allow_dirty_base` is `true`
- refuses an `allowed_files` array longer than 8 unless `override_blast_cap` is `true`
- refuses an empty `allowed_files` list unless `mode` is `certify`

Antigravity stays off Track 2 until `.cursor/protocol/AG_MIRROR.md` records a dry run in which the wrapper fails closed. This phase does not write that record and does not install a `beforeShellExecution` hook. The wrapper sees a command only when it is invoked.

## Shell matcher limit

`wrap.mjs` treats a command as a mutation only in these cases:

- a shell segment starts with `git` and the subcommand is `checkout` or `clean`
- the command string contains an output redirect (`>`, `>>`, `2>`, `&>`)

Checked paths:

- `git checkout` operands after `--`, plus other positionals that contain `/`, `\`, or `.`
- `git clean` path operands
- `git clean` with no path, denied as a worktree-wide mutation
- redirect targets

Passed through:

- commands with no matched mutation, such as `npm run lint`
- read-only commands such as `cat <path>`, including a path outside `allowed_files`
- `git checkout -b <name>` and a branch-only positional such as `git checkout main`

Not matched, so not checked:

- `rm`, `del`, `mv`, `Move-Item`, `Copy-Item`, `tee`, `Set-Content`, `Out-File`, `Add-Content`
- `git reset`, `git apply`, `git restore`
- `git clean` when the segment does not start with `git` (for example `cmd /c git clean`)
- in-place editors (`sed -i`) and redirects built inside `node -e`
- the file named by `git checkout --pathspec-from-file`

A pass-through means this matcher did not see a mutation it knows how to check. It is not an approval that the command is inside `allowed_files`.
