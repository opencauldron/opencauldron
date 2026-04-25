# Contributing to Cauldron

Thanks for your interest in contributing! This guide covers development setup, code style, and how to add new AI model providers.

## Development Setup

```bash
git clone https://github.com/opencauldron/opencauldron.git
cd opencauldron
bun install
cp .env.example .env.local    # fill in required values
docker compose up db -d        # start local Postgres
bun run db:push                # create tables
bun run dev
```

## Code Style

- **TypeScript** — strict mode, no `any` unless unavoidable
- **Formatting** — Prettier with Tailwind plugin (`bun run lint` to check)
- **Components** — [shadcn/ui](https://ui.shadcn.com) built on Radix primitives
- **Database** — [Drizzle ORM](https://orm.drizzle.team) with PostgreSQL
- **Auth** — NextAuth.js v5 with Drizzle adapter

## Adding a New AI Model Provider

Cauldron has a provider abstraction that makes it straightforward to add new image or video models.

### 1. Add the model ID

In `src/types/index.ts`, add your model ID to the `ModelId` type and provider to `ProviderName` (if new).

### 2. Implement the provider

Create a new file in `src/providers/` that implements the `GenerationProvider` interface:

```typescript
import type { GenerationProvider, GenerationParams, GenerationResult } from "@/types";

export const myModelProvider: GenerationProvider = {
  id: "my-model",
  name: "My Model",
  provider: "my-provider",
  mediaType: "image", // or "video"
  capabilities: {
    aspectRatios: ["1:1", "16:9", "9:16"],
    supportsNegativePrompt: false,
    supportsBatchGeneration: false,
    maxBatchSize: 1,
  },
  costPerImage: 0.03,

  async generate(params: GenerationParams): Promise<GenerationResult> {
    // Call the provider's API
    // Return { status: "completed", imageBuffer: Buffer.from(...) }
    // Or for video: { status: "completed", jobId: "..." } for async polling
  },

  // Optional: implement for async video generation
  // async getStatus(jobId: string): Promise<GenerationResult> { ... }
};
```

### 3. Register the provider

Add your provider to `src/providers/registry.ts`. The registry maps model IDs to provider instances and handles API key checks — models without configured keys are automatically hidden.

### 4. Add the env var check

If your provider needs an API key, add the env var to `.env.example` with a comment explaining what models it enables.

### 5. Test

```bash
bun run lint
bun run build
```

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `bun run build` passes
4. Open a PR with a clear description of what changed and why
5. A maintainer will review and merge

## Reporting Issues

- Use the [bug report template](https://github.com/opencauldron/opencauldron/issues/new?template=bug_report.yml) for bugs
- Use the [feature request template](https://github.com/opencauldron/opencauldron/issues/new?template=feature_request.yml) for ideas
- Check existing issues before opening a new one

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
