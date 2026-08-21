# Required checks

Before declaring any code change complete, run the following commands from the repository root:

```sh
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Use `pnpm format` to apply the repository's Prettier formatting before running the checks. Do not bypass or disable ESLint or Prettier rules without explicit approval.
