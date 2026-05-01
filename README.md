# Cauldron

Open source AI media generation studio. Generate images and videos with 15 AI models from a single, beautiful interface.

## Self-host in 60 seconds

Requires Docker + Docker Compose. You'll need a Google OAuth client ([2-minute setup](#setting-up-google-oauth)) — it's the only auth provider for now; alternatives are tracked in `specs/self-host-auth`.

```bash
curl -O https://raw.githubusercontent.com/opencauldron/opencauldron/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/opencauldron/opencauldron/main/.env.example
# Edit .env: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, WORKSPACE_NAME, ADMIN_EMAIL
docker compose up -d
open http://localhost:3000
```

That's it. The container generates a persistent `NEXTAUTH_SECRET`, applies all database migrations, and bootstraps your admin workspace on first boot. Sign in with the Google account you put in `ADMIN_EMAIL` and you'll land on the dashboard as `owner`.

To upgrade later, see [Upgrading](#upgrading-docker-self-host). To run from source as a contributor or fork the project, see [Other ways to run](#other-ways-to-run).

## Features

- **Multi-model support** — 10 image models + 5 video models from Google, xAI, Black Forest Labs, Ideogram, Recraft, Runway, Luma, and more
- **Model variants with cost comparison** — test cheaply with budget models, produce in high quality
- **Prompt enhancement** — template-based and AI-powered prompt rewriting (via Mistral)
- **Credit system** — built-in usage tracking with monthly allocations and badge rewards
- **Asset gallery** — browse, search, tag, and organize all generated media
- **Brand management** — tag assets by brand for easy filtering
- **Team support** — multi-user with admin controls and per-user limits

## Other ways to run

The 60-second Docker quickstart above is the right path for almost everyone running OpenCauldron. Two other paths exist for different needs:

### Contribute / develop on OpenCauldron

For day-to-day work on OpenCauldron itself: run `pnpm dev` against the dev compose's Postgres. HMR works, host tooling (psql, drizzle-kit studio, IDE plugins) connects directly to the DB, no rebuild loop:

```bash
git clone https://github.com/opencauldron/opencauldron.git
cd opencauldron
pnpm install
cp .env.example .env.local                       # then edit with your keys
docker compose -f docker-compose.dev.yml up -d   # local Postgres on :5432
pnpm exec drizzle-kit migrate                    # apply the SQL migrations
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To validate the production Docker path (entrypoint, migration runner, healthcheck) before opening a PR, uncomment the `app` service block at the bottom of `docker-compose.dev.yml` and re-run the same command.

### Fork your own studio

If you want to build a custom studio *on top of* OpenCauldron — your own branding, your own features, your own deploy — there's a scaffolding wizard:

```bash
npx create-opencauldron@latest
```

The interactive wizard walks you through database, storage, and AI provider setup — then clones the repo (without history), generates your `.env.local`, installs dependencies, and initializes a fresh git repo for your fork. **This is for forking, not for running OpenCauldron as-is** — for that, use the Docker quickstart above.

## Upgrading (Docker self-host)

```bash
docker compose pull && docker compose up -d
```

Migrations run automatically on container start. Your data, uploads, and the persisted auth secret all live in named volumes and survive image upgrades. See the [GHCR releases page](https://github.com/opencauldron/opencauldron/pkgs/container/opencauldron) for the changelog.

## Prerequisites

**To self-host:** [Docker](https://docker.com) + Docker Compose, plus a [Google Cloud](https://console.cloud.google.com/apis/credentials) project for OAuth. Nothing else is needed on the host.

**To develop or fork:** Additionally, [Node.js 20+](https://nodejs.org) and [pnpm](https://pnpm.io). A [Neon](https://neon.tech) database is supported as an alternative to the bundled Postgres.

## Configuration

### Required Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Defaults to the bundled Postgres in the Docker self-host path. |
| `NEXTAUTH_URL` | App URL (default: `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Random secret. **Auto-generated and persisted on first boot for Docker self-host.** For dev/fork, generate with `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `WORKSPACE_NAME` | (Self-host only) Studio name for first-boot bootstrap. Optional — bootstrap can also run interactively. |
| `ADMIN_EMAIL` | (Self-host only) Email for the admin account created on first boot. Must match the Google account used to sign in. |

### Storage

Set `STORAGE_PROVIDER` to choose where generated media is saved:

| Value | Description |
|---|---|
| `local` | Save to `./uploads/` directory (default for dev) |
| `r2` | Cloudflare R2 (requires `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) |

> **Note:** Image-to-video (using an uploaded image as input) requires `STORAGE_PROVIDER=r2` because AI providers need a publicly accessible URL to fetch the image. Local storage works for all other features.

### Database

The app auto-detects the database driver from `DATABASE_URL`:
- URLs containing `neon.tech` use the Neon serverless driver (ideal for Vercel/edge)
- All other URLs use the standard `pg` driver (Docker Postgres, Supabase, etc.)

Local Postgres default: `postgresql://cauldron:cauldron@localhost:5432/cauldron`

### Optional

| Variable | Description |
|---|---|
| `ALLOWED_EMAIL_DOMAIN` | Restrict sign-in to a specific email domain (e.g. `mycompany.com`). Leave unset to allow all Google accounts. |

### AI Model API Keys

Models without a configured API key are automatically hidden from the UI. Add keys for the models you want to use:

| Variable | Models |
|---|---|
| `GEMINI_API_KEY` | Imagen 4, Imagen Flash, Imagen Flash Lite, Veo 3 |
| `XAI_API_KEY` | Grok Imagine, Grok Imagine Pro |
| `BFL_API_KEY` | Flux Pro 1.1, Flux Dev |
| `IDEOGRAM_API_KEY` | Ideogram 3 |
| `RECRAFT_API_KEY` | Recraft V3, Recraft 20B |
| `RUNWAY_API_KEY` | Gen-4 Turbo |
| `FAL_KEY` | Kling 2.1 |
| `MINIMAX_API_KEY` | Hailuo 2.3 |
| `LUMA_API_KEY` | Ray 2 |
| `MISTRAL_API_KEY` | Prompt enhancement |

## Supported Models

### Image Generation

| Model | Provider | Cost/Image |
|---|---|---|
| Imagen 4 | Google | $0.040 |
| Imagen Flash | Google | $0.002 |
| Imagen Flash Lite | Google | $0.001 |
| Grok Imagine | xAI | $0.020 |
| Grok Imagine Pro | xAI | $0.070 |
| Flux Pro 1.1 | Black Forest Labs | $0.040 |
| Flux Dev | Black Forest Labs | $0.025 |
| Ideogram 3 | Ideogram | $0.060 |
| Recraft V3 | Recraft | $0.040 |
| Recraft 20B | Recraft | $0.020 |

### Video Generation

| Model | Provider | Cost/Second |
|---|---|---|
| Veo 3 | Google | $0.150 |
| Gen-4 Turbo | Runway | $0.050 |
| Kling 2.1 | Kuaishou (fal.ai) | $0.075 |
| Hailuo 2.3 | MiniMax | $0.045 |
| Ray 2 | Luma AI | $0.070 |

## Setting Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project (or select existing)
3. Go to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth 2.0 Client ID**
5. Set application type to **Web application**
6. Add `http://localhost:3000` to **Authorized JavaScript origins**
7. Add `http://localhost:3000/api/auth/callback/google` to **Authorized redirect URIs**
8. Copy the Client ID and Client Secret to your `.env.local`

## Database Migrations

The Docker self-host path runs migrations automatically on container start — you don't need to invoke anything by hand. The commands below are for the contributor / fork workflows.

```bash
# Apply all SQL migrations to your DB (canonical command)
pnpm exec drizzle-kit migrate

# Generate a new migration after editing src/lib/db/schema.ts
pnpm exec drizzle-kit generate

# Open Drizzle Studio (visual DB browser)
pnpm run db:studio
```

> **Note:** `drizzle-kit push` (sometimes seen in older docs) bypasses the migration history and fails on a fresh database when extensions like `pgvector` are required. Always use `drizzle-kit migrate`.

## Project Structure

```
opencauldron/
├── src/
│   ├── app/             # Next.js App Router pages & API routes
│   ├── components/      # UI components (shadcn/ui)
│   ├── lib/             # Auth, DB, storage, credits, utils
│   ├── providers/       # AI model provider implementations
│   └── types/           # TypeScript types
├── drizzle/             # Database migrations
├── public/              # Static assets & provider logos
├── docker-compose.yml   # Local dev with Postgres
├── Dockerfile           # Production image
└── .env.example         # Environment variable template
```

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for development setup, code style, and how to add new AI model providers.

## License

[Sustainable Use License v1.0](LICENSE) — free for internal business and non-commercial use; commercial redistribution requires a separate agreement.
