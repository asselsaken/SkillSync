# Deploying SkillMatch

SkillMatch needs no database or API keys, so it runs on Vercel's free **Hobby** plan, which is meant for personal, non-commercial projects like a portfolio.

## 1. Import the project (about 5 minutes)

1. Go to [vercel.com](https://vercel.com) and **Sign up** (or log in) **with GitHub**.
2. Click **Add New… → Project**.
3. Find **SkillSync** in the list of your GitHub repositories and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions** and give Vercel access to the repository.
4. On the configuration screen:
   - **Framework Preset:** Next.js (detected automatically)
   - **Project Name:** `skillmatch`. This becomes your address, `skillmatch.vercel.app`, if that name is free.
   - Leave the build and install commands and the environment variables as they are; none are needed.
5. Click **Deploy**. The first build takes 2–3 minutes. It also runs `npm run validate`, so a deploy fails rather than publish an invalid knowledge graph.

Vercel deploys the repository's production branch (`master`). Every push to it, including the daily job-data commits from GitHub Actions, redeploys the site automatically, so the live site always shows current jobs.

## 2. Check it

Open your new address and:

- click **Data engineer** under "Try a sample". Results should appear within a few seconds (the first request after a quiet period takes 2–3 s while the graph loads);
- open **Jobs** and search for `python`;
- visit `/api/sparql?type=stats` to see the graph's size.

## 3. Optional

- **Custom domain:** *Project → Settings → Domains*. You need to own the domain.
- **Put the link on GitHub:** on the repository page, click the gear icon next to **About** and paste the URL into **Website**.
- **Neo4j:** to run against Neo4j + neosemantics instead of the built-in store, set `NEO4J_URI`, `NEO4J_USER` and `NEO4J_PASSWORD` in *Settings → Environment Variables*. The database must be reachable from Vercel, and the n10s plugin isn't available on Neo4j AuraDB.

## How it runs

| | |
|---|---|
| Runtime | Node.js serverless functions (`/api/match`, `/api/jobs`, `/api/sparql`) |
| Data | Turtle files in `ontology/`, bundled with each function, loaded into memory on first request |
| Cold start | ~2–3 s, ~560 MB memory; later requests 0.02–1 s |
| Validation | SHACL at build time (`prebuild`), and whenever data is written |
| Data refresh | GitHub Actions commit new data → Vercel redeploys |

## Running it on your own computer

```bash
npm install
npm run dev
```

Then open http://localhost:3000.
