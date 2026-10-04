# LexiPane Development Instructions

These instructions apply to all repository development work.

## Mandatory first step

Before modifying application code, tests, database schema, build configuration, native code, or user-facing behavior:

1. Read `docs/development-plan.md` in full.
2. Read its **Current Development Status** section and the selected milestone.
3. Update **Current Development Status** before implementation:
   - set the selected task;
   - set its status to `IN_PROGRESS`;
   - record intended scope and relevant risks/dependencies.
4. Do not start implementation until that status update is committed.

## During development

- Stay within the selected milestone unless the development plan is updated first.
- If scope changes materially, update `docs/development-plan.md` before continuing.
- Preserve existing architecture unless the plan explicitly changes it.
- Add/update tests for changed behavior where practical.
- Do not mark work complete based only on code presence.

## Mandatory completion step

Before declaring a task finished:

1. Run the relevant validation gates.
2. Update `docs/development-plan.md` again.
3. Set status to one of:
   - `VERIFYING`
   - `COMPLETE`
   - `BLOCKED`
   - `DEFERRED`
4. Record:
   - what changed;
   - validation evidence;
   - known limitations;
   - next selected task.
5. Commit the status update.

Baseline validation:

~~~bash
npm run typecheck
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
~~~

Additional native/network/schema validation is required when the selected milestone introduces those concerns.

## Planning authority

- `docs/development-plan.md` is the authoritative execution plan and status ledger.
- `docs/roadmap.md` is a strategic summary.
- README documentation is descriptive, not the execution source of truth.

If these documents disagree about current development status, update them so that `docs/development-plan.md` remains authoritative.
