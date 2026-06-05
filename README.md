# Margin6 — Restaurant Inventory & Procurement Platform

A full-stack SaaS platform helping independent restaurant operators manage inventory, purchase orders, and supplier invoices — replacing spreadsheets with automated workflows and real-time visibility.

## The Problem
Most independent restaurants track inventory on paper or spreadsheets. They over-order, waste ingredients, and never know their real food costs until it's too late.

## What I Built

- **PAR-level smart ordering engine** — reads current stock against minimum thresholds and calculates optimal reorder quantities automatically
- **Session-based inventory counting** — approval workflow (draft → in_review → approved) with duplicate detection and data integrity validation
- **3-way PO matching** — flags mismatches between what was ordered, invoiced, and received before operators notice manually
- **Supplier invoice reconciliation** — automated delivery discrepancy detection
- **Multi-location portfolio management** — role-based access controls and cross-location inventory rollups
- **Real-time KPI dashboards** — inventory value, spend trends, R/Y/G risk banding, distressed stock flags
- **Automated low-stock alerts** — scheduled edge functions via pg_cron + Resend

## Engineering Highlights

- **Multi-tenant architecture** with Row Level Security (RLS) for complete data isolation between restaurant accounts
- **Atomic Postgres RPC** for inventory session approval — prevents partial state on concurrent updates
- **19% PLpgSQL** — real database migrations, RLS policies, and edge functions written from scratch
- **Playwright E2E + Vitest unit tests** for critical workflow coverage
- **Structured quality tracker** (DEMO_READINESS.md) with file:line bug references, fix patterns, and test cases

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| State Management | TanStack Query |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions) |
| Database | PostgreSQL with RLS, pg_cron, atomic RPCs |
| Charts | Recharts |
| Testing | Playwright (E2E), Vitest (unit) |
| Deployment | Vercel + Supabase |
| Payments | Stripe |
| Email | Resend |
| AI | Claude Sonnet (invoice parsing) |

## Core Workflow
Inventory Count → Session Approval → Smart Order → Purchase Order
→ Supplier Invoice → 3-way Match → Inventory Update → KPI Dashboard

## Built By
Bhaveen Padigapati — Supply Chain & Operations Analyst
[linkedin.com/in/bhaveen99](https://linkedin.com/in/bhaveen99)
