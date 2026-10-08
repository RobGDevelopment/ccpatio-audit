---
name: qca
description: Automated Quality Control Audit triggered on phase completion. Use when a build phase completes, when certifying a phase, or when qca.mjs reports a verdict.
disable-model-invocation: false
---

# QCA

Automated Quality Control Audit triggered on phase completion.

Run:

```bash
node .cursor/skills/qca/scripts/qca.mjs
```

Transcribe the JSON stdout verbatim. Print that JSON unchanged in the reply.

The stop hook payload field `audit_exit` is the audit result. `audit_exit: 0` matches process exit 0 and a JSON verdict of `CERTIFIED`. `audit_exit: 2` matches process exit 2 and a JSON verdict of `DEFECT_REJECTED`.

Exit code 2 is `DEFECT_REJECTED`. You are forbidden from renaming exit code 2 to `CERTIFIED`. You are forbidden from summarizing a failure as a success. You are forbidden from dropping an `invariantViolations` entry or rewriting the verdict line.

On `DEFECT_REJECTED`, fix the listed invariant violations and run the audit again.
