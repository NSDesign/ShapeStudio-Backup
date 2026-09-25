# ShapeStudio-Backup

Source backup for Shape Studio, a browser-based geometric artwork editor. It supports shape editing, procedural generation, generation sets, compositing, and artwork exports.

## Run locally

Requires Node.js 20 and npm.

```bash
npm ci
npm run dev
```

The development server serves the React/Vite editor through the Express application. On Replit, use the configured **Start application** workflow.

## Checks

```bash
npm run check
npx vitest run
```

## Configuration

The app uses environment variables for its database, sessions, and protected API endpoints. Set the required values in your hosting environment or Replit Secrets; do not commit credentials. The server reads `DATABASE_URL`, `SESSION_SECRET`, and, for protected API routes, `API_KEY` and `LIVE_API_KEY`.

## What this backup includes

The repository contains application source, project configuration, documentation, and tests. Generated exports, local projects, development tooling data, and uploaded artwork in `attached_assets/` are intentionally excluded. The current UI does not reference files in `attached_assets/`; if a future feature adds a bundled asset, commit that specific asset and update the ignore rule.

## License

MIT — see [LICENSE](LICENSE).