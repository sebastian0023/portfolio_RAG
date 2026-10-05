// The ingest and eval tools must run as their dedicated roles, which are budget kill-switch targets (R-14).
// Running them as the operator role would bypass the switch, so they check who they are before spending anything.
export function isAssumedRole(arn: string, roleName: string): boolean {
  return new RegExp(
    `^arn:aws:sts::\\d{12}:assumed-role/${roleName.replace(/[^a-zA-Z0-9-]/g, '')}/[\\w+=,.@-]+$`,
  ).test(arn);
}
