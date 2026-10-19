# Repository Guidelines

## Project Structure & Module Organization

LinkDeck is a React and TypeScript Manifest V3 extension organized as a pnpm workspace. `src/` contains application entrypoints, feature composition, and integration tests. Feature implementation, types, storage keys, styles, and colocated tests live in `packages/bookmarks`, `packages/data-transfer`, `packages/gist-sync`, `packages/tab-search`, `packages/tab-auto-close`, and `packages/same-tab-navigation`. Shared visual components live in `packages/ui`, small common utilities in `packages/shared`, and Chrome mocks and test setup in `packages/test-utils`.

Internal packages are private and export TypeScript source for the root Vite build. Declare internal dependencies with `workspace:*` and import other packages through their explicit `exports` subpaths. Keep UI, background, and injected-script entrypoints separate. Feature packages must not import application files or depend on each other cyclically. Keep `test-utils` in development dependencies only.

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

Tests use Vitest, jsdom, and Testing Library. Name them `*.test.ts` or `*.test.tsx` and colocate them with the implementation. Use `@linkdeck/test-utils` for browser APIs. Root tests cover feature composition, background registration, and workspace dependency boundaries. Cover user flows, storage edges, validation failures, and rollback paths. There is no coverage threshold, but new behavior should include focused regression tests.

## Commit & Pull Request Guidelines

Use Conventional Commit subjects such as `feat(search): add cross-group search` and `fix(favicon): switch host`. Keep subjects imperative and scoped when useful. Pull requests should explain user impact, report `pnpm check`, link relevant issues, and include popup screenshots for visual changes. Call out changes to permissions, synced data formats, external requests, or privacy copy.

## Security & Configuration

Keep permissions minimal. Do not add remote scripts, telemetry, secrets, or broader tab access without review. Bookmark data stays in `chrome.storage.sync`; favicon requests expose only the hostname.
