# Contributing to Reckon

Read `BOOTSTRAP.md`, `AGENTS.md`, the architecture lock, canonical contracts and the assigned worker handoff before coding.

## Branches

Workers branch from the TL3 dispatch SHA.

- W1: `work/W1-<work-item>`
- W2: `work/W2-<work-item>`
- W3: `work/W3-<work-item>`

Workers do not merge.

## Scope

Workers change only their owned paths and the tests needed to prove those paths. Shared architecture, canonical contracts, schemas and composition roots are TL3-owned.

## Completion

Every work item must record exact base/final SHA, owned-path diff, commands/results, acceptance mapping, limitations and unresolved ACRs.

## Evidence classes

Every claim is labeled as fixture, controlled/local, staging or production-observed.

## Forbidden commits

Never commit secrets, credentials, browser sessions, provider tokens, private source material or unrelated generated artifacts.

TL3 performs merge and reconciliation.