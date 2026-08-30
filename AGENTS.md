# Repository Guidelines

## Project Structure & Module Organization

LinkDeck is a React and TypeScript Manifest V3 extension. `src/App.tsx` owns the popup flow, while reusable UI lives in `src/components/`. Keep feature code together, as in `src/data-transfer/`; place browser integration, persistence, and validation in `src/lib/`. Shared types belong in `src/types.ts`, with test setup and Chrome mocks in `src/test/`.

Static extension files are under `public/`. Store artwork lives in `assets/` and `store-assets/`; release copy is in `docs/`. `scripts/package.mjs` creates the archive. Do not edit or commit generated `dist/` and `release/` output.

## Build, Test, and Development Commands

- `pnpm install` installs dependencies from `pnpm-lock.yaml`.
- `pnpm dev` starts Vite for popup UI development.
- `pnpm test` runs Vitest once; `pnpm test:watch` reruns tests while editing.
- `pnpm build` type-checks with `tsc --noEmit` and builds the extension into `dist/`.
- `pnpm check` runs tests and the production build; use it before a pull request.
- `pnpm package` rebuilds and creates `release/linkdeck-v1.1.0.zip`.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, no semicolons, and trailing commas in multiline structures. TypeScript runs in strict mode. Use PascalCase for React components, camelCase for functions and variables, and kebab-case for feature directories. Prefer small function components and keep testable business logic outside JSX. Add doc comments to new classes, interfaces, public APIs, and non-obvious business logic. No formatter or linter is configured, so match nearby files.

## Testing Guidelines

Tests use Vitest, jsdom, and Testing Library. Name them `*.test.ts` or `*.test.tsx` and colocate them with the implementation. Use `src/test/chrome.ts` for browser APIs. Cover user flows, storage edges, validation failures, and rollback paths. There is no coverage threshold, but new behavior should include focused regression tests.

## Commit & Pull Request Guidelines

Use Conventional Commit subjects such as `feat(search): add cross-group search` and `fix(favicon): switch host`. Keep subjects imperative and scoped when useful. Pull requests should explain user impact, report `pnpm check`, link relevant issues, and include popup screenshots for visual changes. Call out changes to permissions, synced data formats, external requests, or privacy copy.

## Security & Configuration

Keep permissions minimal. Do not add remote scripts, telemetry, secrets, or broader tab access without review. Bookmark data stays in `chrome.storage.sync`; favicon requests expose only the hostname.
