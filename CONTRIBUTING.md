# Contributing

Thanks for helping. These examples exist to show, in plain sight, how a real business takes payments
through KetaPay escrow, so clarity matters more than cleverness.

## Running and checking

- Run an example as its README says, with an `sk_test_` key (test mode: no real money moves).
- Run its scenarios against both versions before you open a PR:

  ```sh
  cd tools && npm install
  npm run scenarios -- <example> node
  npm run scenarios -- <example> php
  ```

- Changed anything in `tools/shared/`? Run `npm run sync` (in `tools/`) to copy it into every example.
  The Check workflow fails if the copies differ.

## What a change should keep

- **One readable file per server.** Every KetaPay call stays in plain sight, in the order it happens.
- **Node and PHP stay equal.** A change to one version goes into the other, and the same scenarios pass
  against both.
- **The story comes first.** An example's README explains who pays whom and what KetaPay holds before
  any code.
- **Only the official SDKs** (`@ketapay/node`, `ketapay/ketapay-php`, `@ketapay/checkout`,
  `@ketapay/react`) from npm and Packagist.

## Pull requests

- Open the PR into `main` and fill in the template.
- One change per PR. Say which examples you ran the scenarios for.
- Never put a key (`sk_live_`, `sk_test_`) or webhook secret in code, issues, PRs or logs.

Found a security problem? See [SECURITY.md](SECURITY.md) instead of opening an issue.
