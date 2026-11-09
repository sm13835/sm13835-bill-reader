# Plan.md — Optional Risk, Architecture & Budget Draft (Build 2)

Use this as a scratchpad if helpful. Publish PRD v2 and the Build 2 log on `docs/index.html`; this file is not a separate hand-in.

**Due:** Monday, Nov 16, 2026 at 12:00 PM (Noon)  
**Builder:** [Your Name]

---

## 1. What is the riskiest part?
*What is the single most likely reason this product fails to work for a real user (e.g., model hallucination on messy PDFs, latency, auth, bad data, third-party API limits)? How does your smallest local version test that risk first?*

- **#1 Technical / Product Risk:** 
- **How Build 2 tests it right now:** 

## 2. The Smallest Working Version (Architecture)
*Use AI to understand the main components, data flow, and risks, then explain them in your own words.*

- **Stack (Frontend / Backend / DB):** 
- **Local run command:** 
- **Local URL (Build 2):** 
- **Models used (via OpenRouter or provider):** 

## 3. Time & Money Budget
*Estimate what it will cost to build and what it costs each time a user runs a job.*

| Item | Estimate | Notes |
| :--- | :--- | :--- |
| **Build budget (coding agent / OpenRouter)** | `$` | |
| **Unit cost per user action (inference/API)** | `$ / run` | |
| **Hosting cost (monthly)** | `$ / mo` | |
| **Your engineering time budget** | `hrs/wk` | |

## 4. Security & Recovery Checklist
- [ ] `.env` and API keys are excluded via `.gitignore`
- [ ] Spending limits or alerts are configured where the provider supports them
- [ ] Least-privilege permissions on any external data/APIs
- [ ] Git save point for undoing a broken local change; add a cloud rollback path in Build 5
