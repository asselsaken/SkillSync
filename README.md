# SkillMatch

Semantic job matching on a knowledge graph. Upload a résumé (PDF) and get jobs ranked by how well your skills cover each job's requirements, with an explanation for every match.

Unlike keyword search, SkillMatch understands how skills relate: if a job asks for **SQL** and your résumé says **PostgreSQL**, that counts, because the skill graph knows PostgreSQL is a kind of SQL.

## How it works

1. **Extract**: the résumé text is scanned for every skill name and alias in the ontology, using token-boundary matching (so "R" isn't found inside "for", and "Java" isn't found inside "JavaScript").
2. **Relate**: for each skill a job requires, the candidate's strongest related skill is found in the graph:

   | Relation | Example | Weight |
   |---|---|---|
   | exact | Python → Python | 1.0 |
   | equivalent | `owl:SymmetricProperty` | 1.0 |
   | narrower (you're more specific) | PostgreSQL → SQL | 0.85 |
   | two-level narrower | Django → Python → Programming | 0.7 |
   | similar | PyTorch ≈ TensorFlow | 0.6 |
   | broader (you're more general) | SQL → PostgreSQL | 0.5 |

3. **Score**: the weights are summed and divided by the number of required skills, so missing requirements lower the score. Each result lists the matched skills, how each one matched, and what's missing.

## Knowledge graph

| File | Contents |
|---|---|
| `ontology/skillmatch.owl.ttl` | OWL classes and properties (`broaderSkill` is transitive, `narrowerSkill` is its inverse, `equivalentSkill` is symmetric) |
| `ontology/skills.rdf.ttl` | about 125 skills with aliases and relations |
| `ontology/sample-data.rdf.ttl` | sample job postings, organisations and people |
| `ontology/skillmatch.shacl.ttl` | SHACL shapes, including SHACL-SPARQL rules (for example, a skill can't be similar to itself) |

All data is **SHACL-validated on load**. The app refuses to start on an invalid graph. Core shapes are checked with `rdf-validate-shacl`, and `sh:sparql` constraints are executed with Oxigraph.

## Storage backends

| Backend | When | Notes |
|---|---|---|
| **In-memory** (default) | `NEO4J_URI` not set | N3.js for lookups and [Oxigraph](https://github.com/oxigraph/oxigraph) (WASM) for real SPARQL 1.1. No services needed. |
| **Neo4j + neosemantics** | `NEO4J_URI` set | Loads the same Turtle files into Neo4j via n10s. |

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 and upload a PDF résumé. A sample is in `tests/fixtures/sample-resume.pdf`.

To use Neo4j instead, copy `.env.local.example` to `.env.local` and fill in `NEO4J_URI`, `NEO4J_USER` and `NEO4J_PASSWORD`. The database needs the APOC and n10s plugins.

## API

| Endpoint | Description |
|---|---|
| `POST /api/match` | multipart `file` (PDF, ≤ 5 MB) → extracted skills and ranked matches |
| `GET /api/jobs` | all job postings |
| `GET /api/sparql?type=…` | named queries: `skills`, `jobs`, `related-skills&skill=python`, `jobs-by-skill&skill=sql`, `skill-hierarchy`, `match&skills=python,sql`, `stats` |
| `POST /api/sparql` | `{"sparql": "SELECT …"}` runs a read-only SPARQL query (prefixes `sm:`, `skill:`, `job:`, `org:` are predefined) |

```bash
curl -s -X POST localhost:3000/api/sparql -H 'content-type: application/json' \
  -d '{"sparql":"SELECT ?name WHERE { ?s sm:broaderSkill skill:sql ; sm:skillName ?name }"}'
```

## Development

```bash
npm test           # unit + graph tests (Vitest)
npm run typecheck
npm run lint
npm run build
```

CI runs all four on every push and pull request (`.github/workflows/ci.yml`).

## Project layout

```
app/                 Next.js App Router: pages and API routes
lib/rdf/
  graph-store.ts     backend interface; picks in-memory or Neo4j
  store.ts           in-memory store (N3 + Oxigraph)
  neo4j-store.ts     Neo4j + n10s store
  shacl.ts           SHACL + SHACL-SPARQL validation
  semantic-matcher.ts  skill extraction and scoring
  sparql.ts          named SPARQL queries
ontology/            OWL, SHACL, skills and sample data (Turtle)
tests/               Vitest suites and fixtures
```

## Stack

Next.js 14, React 18, TypeScript, Tailwind CSS · N3.js, Oxigraph, rdf-validate-shacl · Neo4j driver (optional) · pdf-parse · Vitest

## License

MIT
