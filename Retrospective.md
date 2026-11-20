# Retrospective

Accident narratives for this repo.

Routing: narrative stays here. A project-specific rule that will recur may become one line in `AGENTS.md`. Cross-project lessons go to global rules. If it can be checked by a machine, add a hook or test instead of prose.

## 2026-11-21 — ssh-deploy self-test dropped connections on OpenSSH ≥ 9.8 runners

**Symptom.** `Self Test — ssh-deploy` run 44741457393: cases 1–4 passed, then case 5 ran and
failed inside `Execute remote script` with `Connection closed by 127.0.0.1 port 22` (exit 255).
Because that step failed, case 5's assertion step and case 6 were skipped.

**Cause.** OpenSSH ≥ 9.8 enables `PerSourcePenalties` by default and exempts no address. A
connection that disconnects without authenticating costs its source a `noauth` penalty
(1s each, enforcement starts once 15s of penalty has accrued). `ssh-keyscan` opens six
unauthenticated connections per host (rsa, ecdsa, ed25519, ecdsa-sk, ed25519-sk,
mldsa44-ed25519), and the action ran it once per case — so by case 5 the runner's own source
address was over the threshold and sshd refused every later connection. The upstream manual
already warns that the default "may penalise legitimate scanning tools such as
ssh-keyscan(1)". The failure looked random (case 5 of 6, only on newer runner images) but was
a deterministic limit on the runner's own source address.

**Fix.**

- `self-test-ssh-deploy.yml` writes `/etc/ssh/sshd_config.d/99-self-test.conf` with
  `PerSourcePenalties no` and `MaxStartups 100:30:100`, validated with `sshd -t` and confirmed
  through `sshd -T`. Daemons without the option fall back to exempting `127.0.0.1,::1`, then
  to `MaxStartups` only.
- A probe step runs 20 host-key scans after the reload and fails the job when sshd stops
  serving — the exact condition that broke the suite.
- The key-pair step captures the host key once; cases 2–6 pass it through `known-hosts:`,
  case 1 keeps the live `ssh-keyscan` branch of the action.
- `ssh-deploy` action: the private key and the host key material live in invocation-specific
  temp files under `$RUNNER_TEMP` (only the provided `known-hosts` material or the live
  keyscan is trusted; the shared `~/.ssh/known_hosts` is never read or written), both files
  are removed in the cleanup step, and the connection uses `StrictHostKeyChecking=yes` plus
  `ConnectTimeout=30`.
- The self-test gained a negative case: a deliberately wrong host key must make the
  deployment fail without running the remote script.

**Prevention.** In SSH self-tests, when earlier cases pass but a later one fails with
`Connection closed by 127.0.0.1 port 22`, check OpenSSH per-source penalties
(`PerSourcePenalties`) and connection limits (`MaxStartups`) first. Neutralize them
(`PerSourcePenalties no`) and re-probe the daemon afterwards.
