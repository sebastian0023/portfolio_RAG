## Scope

- Phase and linked Notion task(s):
- Phase goal and exit criteria addressed:
- Behavior and files changed:
- ADR or risk updates:

## Exit evidence

- [ ] Lint, typecheck, formatting, Vitest
- [ ] Terraform fmt/validate/plan and Checkov, when infrastructure exists
- [ ] Phase-specific acceptance and cost/security checks
- [ ] Relevant local or post-deploy smoke (or reason not applicable)
- [ ] No secrets or private knowledge content committed

## Release

- Migration, deployment, and rollback notes:
- PR into `dev` from the phase branch; `main` only for Phase 7 release after Phase 0 initialization.
