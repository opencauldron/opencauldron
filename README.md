# Cauldron

Open source AI media generation studio. Generate images and videos with 15 AI models from a single, beautiful interface.

## Features

- **Multi-model support** — 10 image models + 5 video models from Google, xAI, Black Forest Labs, Ideogram, Recraft, Runway, Luma, and more
- **Model variants with cost comparison** — test cheaply with budget models, produce in high quality
- **Prompt enhancement** — template-based and AI-powered prompt rewriting (via Mistral)
- **Credit system** — built-in usage tracking with monthly allocations and badge rewards
- **Asset gallery** — browse, search, tag, and organize all generated media
- **Brand management** — tag assets by brand for easy filtering
- **Team support** — multi-user with admin controls and per-user limits

## Quick Start

### Option 1: CLI Wizard (Recommended)

```bash
npx create-opencauldron@latest
```

The interactive wizard walks you through database, storage, and AI provider setup — then clones the repo, generates your `.env.local`, installs dependencies, and initializes git. Follow the printed next steps to start your dev server.

### Option 2: Git Clone

```bash
git clone https://github.com/opencauldron/opencauldron.git
cd opencauldron
bun install
cp .env.example .env.local    # then edit with your keys
docker compose up db -d        # start local Postgres
bun run db:push                # create tables
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Option 3: Docker

```bash
git clone https://github.com/opencauldron/opencauldron.git
cd opencauldron
cp .env.example .env.local    # then edit with your keys
docker compose up
```

## Prerequisites

- [Bun](https://bun.sh) (or Node.js 20+)
- [Docker](https://docker.com) (for local Postgres) or a [Neon](https://neon.tech) database
- A [Google Cloud](https://console.cloud.google.com/apis/credentials) project for OAuth

## Configuration

### Required Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_URL` | App URL (default: `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Random secret — generate with `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

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

```bash
# Push schema to database (development)
bun run db:push

# Generate and run migrations (production)
bun run db:migrate

# Open Drizzle Studio (visual DB browser)
bun run db:studio
```

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

[MIT](LICENSE)
