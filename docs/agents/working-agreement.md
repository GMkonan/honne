# AI collaboration working agreement

## Ownership

Honne belongs to its owner. AI assists with implementation, but product behavior, architecture, dependencies, data safety, security boundaries, and release decisions are made collaboratively.

The code should remain understandable, intentional, and consistent with how the owner wants to build and operate the project. Automation must reduce repetitive work without replacing ownership or judgment.

## Default workflow

1. Discuss the desired behavior and relevant trade-offs.
2. Inspect the existing code and project guidelines before proposing changes.
3. Surface consequential ambiguity instead of resolving it silently.
4. Implement the smallest coherent change in the project's existing style.
5. Add behavioral regression coverage for changed behavior.
6. Run focused checks while iterating and the complete validation contract before delivery.
7. Self-review the full diff for correctness, security, accessibility, compatibility, scope, and unnecessary complexity.
8. Prepare English local commits when a change is ready, then wait for the owner to authorize any remote delivery action.

## Git and delivery

- Small changes may be committed to the local `main` after validation.
- A local commit does not authorize a push.
- Pushes, pull requests, merges, and releases require current explicit authorization.
- Use Conventional Commits in English.
- Do not force-push, bypass hooks, or self-approve or self-merge.

## Planning and tracking

GitHub issues are optional for small, coherent changes. Use the shared tracker when an idea needs durable product context, unresolved decisions, multiple delivery slices, coordination, or explicit history.

Persistence migrations, authentication, public exposure, provider integrations, new dependencies, release changes, and other high-risk work require an explicit plan, compatibility analysis, and rollback strategy. They do not require a named pipeline.

Avoid lifecycle ceremony, automatic task creation, or labels that exist only to represent AI workflow state.

## Automation boundaries

AI should automate formatting, test creation, test execution, validation, documentation consistency, diff review, and delivery preparation.

AI must not:

- invent product behavior when a meaningful choice remains open;
- select a dependency, migration strategy, provider, or security model without review;
- weaken tests to make a change pass;
- claim validation that was not executed;
- push a branch, open or update a pull request, merge, release, force-push, delete data, or perform another remote or irreversible action without explicit authorization for the current change;
- turn unrelated changes into a polished but incoherent commit or pull request.

Create a reusable skill or script only after a task is repeated enough to justify the abstraction. Prefer repository scripts for deterministic commands and AI skills for judgment-heavy, reusable procedures.

## Sources of truth

- `GUIDELINES.md`
- `backend/GUIDELINES.md`
- `frontend/GUIDELINES.md`
- `docs/agents/language.md`
- `docs/agents/tracker.md`
- `docs/agents/validation.md`
