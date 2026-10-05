# tests/deployment — release-gate lockstep (S4-002, release lane)

`verify-deployment.test.ts` locks `scripts/verify-deployment.mjs` — the
S4-002 deployment verification gate the Lead runs post-deploy — against
the repository, so the gate can never silently drift from the surfaces it
probes:

1. **Marker lockstep** — the content markers the gate asserts
   (`Reckon Studio` / `Reckon documentation` / `Recommendation
   infrastructure`) must exist verbatim in the shipped sources
   (`apps/web/src/components/shell/site-header.tsx`,
   `apps/docs/src/app/page.tsx`,
   `apps/marketing/src/lib/marketing-content.ts`). App copy drift fails
   the battery here, not the Lead's post-deploy gate run.
2. **Arg contract** — missing env prints the usage line naming all four
   required URL variables and exits non-zero; `--help` exits 0.
3. **Probe shape (stub servers)** — stub `node:http` servers speaking
   the frozen response shapes (api `/healthz` liveness envelope + the
   typed 401 `UNAUTHENTICATED` envelope on a frozen route; the three
   HTML marker pages) make the gate pass 4/4 with exit 0; a surface
   answering the wrong shape produces its per-surface FAIL line and
   exit 1.

EVIDENCE CLASS: controlled-local (stub servers standing in for the
deployed surfaces — the gate's assertions themselves are cross-checked
against the shipped sources per §1; the same lockstep law as
`apps/api/test/e2e-journey-map.test.ts`).
