# BVC Portfolio

An early-stage, bilingual portfolio accounting and analysis application for Casablanca Stock Exchange equities. Development uses clearly labelled synthetic data and administrator-supplied CSV files only. It is not licensed for public market-data redistribution or production use.

## Local checks

Requires Node 22+, pnpm 10+, Docker, and a local Supabase CLI for database integration tests.

```bash
pnpm install
pnpm check
```

Copy `.env.example` to `.env.local` and provide a local Supabase project before exercising authentication. Never commit environment values.

The authoritative source documents are preserved under `MVP_BVC_Engineering_Pack/`.
