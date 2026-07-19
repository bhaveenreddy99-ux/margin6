# Deployment runbook (placeholder)

**Status:** Placeholder — not approved for production use

---

## Before any production change

1. **Human approval** for migration and edge deploy scope
2. **Backup** Supabase project (point-in-time / logical dump per Supabase docs)
3. **Staging apply** of exact migration set
4. Run smoke tests: auth, invite accept, count approve, receipt confirm, smart order submit
5. Review [`../status/production-drift.md`](../status/production-drift.md)

---

## Migration order (when approved)

1. Corrective RLS (e.g. location isolation) — if not yet on prod
2. Grant hardening migrations
3. Regenerate TypeScript types from staging
4. Deploy Edge Functions if changed (verify `send-invite` separately)
5. Deploy Vercel frontend

---

## Rollback

- Restore policies/grants from pre-migration SQL dump
- Revert Vercel deployment to previous promotion
- Do **not** edit `supabase_migrations.schema_migrations` without DBA review

---

## Explicitly forbidden without review

- `supabase db push` to production from unreviewed branch
- `supabase migration repair` without confirming zero SQL re-execution
- Dropping legacy invite tables

---

**This runbook will be expanded when a production release is approved.**
