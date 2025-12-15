# SkillMatch

Semantic job matching with RDF/OWL ontology, SHACL validation, and SPARQL over Neo4j (n10s). Upload a resume PDF and get ranked job matches with semantic skill reasoning.

## What it does
- Upload PDF resumes and extract skills via ontology (word-boundary matching on names/aliases).
- Semantic scoring of requirements: exact/equivalent/narrower/broader/similar with weights and normalization by required skills.
- SPARQL API on Neo4j + n10s (fallback disabled), SHACL validation on Turtle load.
- Browse jobs and SPARQL queries via the Next.js UI.

## Stack / versions
- Next.js 14.0.4, React 18, TypeScript 5
- Neo4j Driver 6, neosemantics (n10s) on DB side
- RDF/OWL: n3, rdf-validate-shacl, sparqljs
- pdf-parse for resume text extraction

## Quick start
```bash
npm install
```

Create `.env.local`:
```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
```

Run dev:
```bash
npm run dev
```
Lint:
```bash
npm run lint
```
Build/prod:
```bash
npm run build
npm run start
```

## Tree (short)
```
app/                # Next.js App Router (UI + API)
  api/              # /api/match, /api/jobs, /api/sparql
  about/, jobs/, page.tsx
lib/rdf/            # RDF/Neo4j/SPARQL, semantic matcher
ontology/           # OWL, SHACL, skill/job data
docs/               # Architecture, structure, SPARQL examples
NEO4J_SETUP.md      # Neo4j + n10s setup
```

## Config
- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` — required; without them the service will not start (fallback disabled).
- Ontology files: `ontology/skillmatch.owl.ttl`, `skills.rdf.ttl`, `sample-data.rdf.ttl`, `skillmatch.shacl.ttl`.

## Deploy
- Build `npm run build`, then `npm run start` on a host with access to Neo4j+n10s.
- Ensure Neo4j loads `apoc` and `n10s` plugins and credentials match `.env.local`.

## License
MIT
