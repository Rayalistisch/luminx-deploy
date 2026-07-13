# Deploy — architecture

> Status: **reserved, not implemented.** This document is the shape `deploy` will take, and the
> reason `generate` already has the abstractions it needs. Nothing here ships in LuminX 1.0; it
> ships in 1.x, as a separate package. See §11 of [`architecture.md`](architecture.md).

`generate` brings *this* machine's CMS up to the config. `deploy` applies a **reviewed plan** to
*another* environment — production — where the rules are different: no interactive prompts, no
service-API writes, and a plan that must be verified against the target before a byte is written.

The point of preparing it now, without building it, is that the shape of deploy decides whether
`generate` has the right seams. It does, because three of them were built to be reused:

1. **The plan is a serialisable artefact.** `luminx plan -o plan.json` writes it already, with a
   `sourceHash` and a `baseHash` (§8.2, §11.2). Deploy reads that file; it does not recompute.
2. **The runner is an abstraction.** `SshRunner` is the fourth implementation of an interface the
   other three already satisfy (§7.3). It is stubbed today and refuses to run.
3. **`snapshot` / `restore` are on the adapter contract**, not in the generate flow (§7.1). Deploy
   reuses them unchanged.

## The flow

```
  develop (local)          CI (pull request)              production
 ─────────────────      ────────────────────────      ────────────────────
  luminx generate   →    luminx plan -o plan.json →     luminx deploy
  (service API,          plan.json committed to          --plan plan.json
   fast, mutates          the PR                         (project-config YAML,
   the local DB)         → a human reviews the diff       read-only-safe)
```

Plan in CI, review in the PR, apply on production. It is Terraform's plan/apply split, and it is
why `plan` is a first-class command rather than a flag on `generate`.

## What deploy adds

| Concern | Direction |
|---|---|
| **Read-only project config** | On production `allowAdminChanges` is off (§9.3), so the service API refuses. Deploy writes `config/project/*.yaml` and runs `php craft project-config/apply`. That is the `ProjectConfigWriteStrategy`, the sibling reserved beside `ServiceApiWriteStrategy` in the plugin today (`WriteStrategy`). |
| **Environments** | `luminx.config.json` stays one file; where to deploy comes from `luminx.environments.json` (hosts, paths, runner, strategy). Config says *what*, environments say *where*. |
| **Plan verification** | `plan.json` carries a `baseHash` — the CMS state it was planned against. If production has drifted from that hash, deploy refuses unless `--force`. This is Terraform's refresh check, and the reason the differ may read the lockfile but never blindly trusts it. |
| **Atomicity** | Craft's project config is not globally transactional (§9.5). Deploy does snapshot → apply → verify (introspect and compare hashes with the plan) → restore automatically on mismatch. |
| **Auth** | No tokens, no HTTP endpoint. `SshRunner` inherits the SSH trust the developer or CI already has. Opening no inbound endpoint is a security property, not a limitation. |

## Licence boundary

Deploy is the natural commercial line (§11.3). `shared`, `core`, `parsers`, `cli`,
`adapter-craft` and the plugin are MIT and fully usable without it — you can model, generate,
sync, plan and undo with none of this document implemented. `@luminx/deploy` and the environment
orchestration may ship under different terms. Nothing in `core` exists solely for deploy, and the
seams above are the proof: each one earns its place in the open-source CLI first.
