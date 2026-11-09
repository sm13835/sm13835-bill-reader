# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Bill Reader turns a long House bill into a plain-English brief personalized to one member's district and public commitments, with alerts when a yes vote would conflict with a commitment.
- **Primary user & core workflow:** Members of Congress and their legislative staff. See the living PRD in `docs/index.html`.
- **Tech stack:** Node 24 (built-in modules only) / plain HTML / JSON files in `data/` / OpenRouter API

## 2. Commands
- **Install dependencies:** None. Requires Node 24. For model runs: `cp .env.example .env`, then add your key.
- **Generate a brief (paid model calls):** `node app/analyze.js`
- **Run locally:** `node app/server.js`, then open http://localhost:3000
- **Run deterministic tests:** `node --test`
- **Run model evals:** Not built yet (planned for Build 4, Track A).

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
