Info 290 Final Project Submission

Course: Info 290 Final Project Submission  
Name: Assel Sakenkyzy  
Other Team Members: Solo  
Project Title: SkillSync

Project Description: SkillSync is a semantic job-matching assistant that ingests PDF resumes, extracts skills via an RDF/OWL ontology, and ranks job postings using Neo4j + SPARQL with SHACL validation. It returns explainable matches (exact, equivalent, narrower, broader, similar) with per-skill rationale.

Pain Point you are addressing: Keyword search misses semantic overlap and floods candidates with irrelevant matches, wasting time and producing unfair rankings.

Solution: Parse resume text, map it to ontology skills (including aliases with word-boundary matching), execute SPARQL over Neo4j (n10s) to compute weighted semantic matches, normalize by required skills to penalize gaps, and surface only high-quality results (>50%).

Secret Sauce: An RDF/OWL skill graph validated by SHACL; Neo4j + n10s for true SPARQL; weighted semantic edges (exact, equivalent, narrower, similar, broader); word-boundary extraction to avoid alias false positives; and scoring normalized by required skills (best match per requirement).

Audience: Job seekers who need higher-precision matches for technical roles, initially in software, data, and quantitative domains.

RDF Knowledge structures with real data and associated SHACL

RDF Triple Structure (Turtle/N-Triples):
- Prefixes used:  
  - `@prefix sm: <http://skillmatch.org/ontology#> .`  
  - `@prefix skill: <http://skillmatch.org/skill#> .`  
  - `@prefix job: <http://skillmatch.org/job#> .`  
  - `@prefix org: <http://skillmatch.org/org#> .`  
  - `@prefix person: <http://skillmatch.org/person#> .`
- Skill definitions and relations:  
  - `skill:python sm:skillName "Python" .`  
  - `skill:python sm:broaderSkill skill:programming-languages .`  
- Job posting with organization and requirements:  
  - `job:stripe-swe-1 sm:jobTitle "Software Engineer, Backend" .`  
  - `job:stripe-swe-1 sm:requiresSkill skill:python, skill:javascript .`  
  - `job:stripe-swe-1 sm:postedBy org:stripe .`  
  - `org:stripe sm:organizationName "Stripe" .`  
- Person with skills:  
  - `person:alice sm:personName "Alice Doe" .`  
  - `person:alice sm:hasSkill skill:python, skill:sql, skill:django .`

Associated SHACL Shape:
```
sm:JobPostingShape a sh:NodeShape ;
  sh:targetClass sm:JobPosting ;
  sh:property [ sh:path sm:jobTitle ; sh:minCount 1 ; sh:datatype xsd:string ] ;
  sh:property [ sh:path sm:requiresSkill ; sh:minCount 1 ; sh:node sm:Skill ] .
```
Person Shape (SHACL):
```
sm:PersonShape a sh:NodeShape ;
  sh:targetClass sm:Person ;
  sh:property [ sh:path sm:personName ; sh:minCount 1 ; sh:datatype xsd:string ] ;
  sh:property [ sh:path sm:hasSkill ; sh:minCount 1 ; sh:node sm:Skill ] .
```
Skill Shape (SHACL):
```
sm:SkillShape a sh:NodeShape ;
  sh:targetClass sm:Skill ;
  sh:property [ sh:path sm:skillName ; sh:minCount 1 ; sh:datatype xsd:string ] ;
  sh:property [ sh:path sm:skillAlias ; sh:datatype xsd:string ; sh:maxCount 5 ] .
```
Validation example: a job missing `sm:jobTitle` or without any `sm:requiresSkill` fails `JobPostingShape`; a skill without `sm:skillName` fails `SkillShape`.

OWL used:
- `sm:equivalentSkill a owl:SymmetricProperty .`
- `sm:broaderSkill a owl:TransitiveProperty .`
- `sm:narrowerSkill owl:inverseOf sm:broaderSkill .`

Named Entity Recognition (NER):
Techniques: Ontology-driven lookup with word-boundary regex over skill names and aliases, plus an LLM-assisted pass to extract entities from job postings. The matcher targets standalone tokens rather than substrings—“R” inside “for” is ignored, while “C# developer” correctly matches C#—covering C/C++/C#/Node.js. Extraction runs asynchronously against the Neo4j-backed skill catalog; LLM output is mapped into the same RDF templates.

Successes and/or Issues Encountered: Boundary-aware matching reduced noisy hits on short tokens. Score inflation was resolved by retaining only the strongest match per required skill and normalizing by requirement count, which stabilized rankings. The LLM-assisted extraction improved recall on employer-authored job text where phrasing varies from the ontology labels.

NER Example (text → entities → RDF):
- Input: “C# developer at Stripe, building data pipelines with Python and SQL.”
- Detected skills: C#, Python, SQL.
- Detected org/title (next iteration via spaCy patterns/LLM): Stripe (ORG), Developer (ROLE).
- RDF emitted:
  - `person:alice sm:hasSkill skill:csharp .`
  - `person:alice sm:hasSkill skill:python .`
  - `person:alice sm:hasSkill skill:sql .`
  - `person:alice sm:hasRole job:stripe-swe-1` (future when roles are extracted)
- Planned spaCy layer: add a pattern ruler to tag ROLE/ORG/TIME; fine-tune or few-shot an LLM to output entities directly into RDF templates for new domains.

SPARQL and/or Cypher Queries used in solution
Query Language: SPARQL (Neo4j n10s)

Query (MATCH_PERSON_TO_JOBS):
```
SELECT ?job ?title ?org ?matchType ?personSkill ?jobSkill WHERE {
  VALUES ?personSkill { <skill:python> <skill:sql> }
  ?job a sm:JobPosting ; sm:jobTitle ?title ; sm:postedBy ?orgUri ; sm:requiresSkill ?jobSkill .
  ?orgUri sm:organizationName ?org .
  { FILTER(?personSkill = ?jobSkill) BIND("exact" AS ?matchType) }
  UNION { ?personSkill sm:equivalentSkill ?jobSkill BIND("equivalent" AS ?matchType) }
  UNION { ?personSkill sm:broaderSkill ?jobSkill BIND("narrower" AS ?matchType) }
  UNION { ?personSkill sm:narrowerSkill ?jobSkill BIND("broader" AS ?matchType) }
  UNION { ?personSkill sm:similarTo ?jobSkill BIND("similar" AS ?matchType) }
}
```

Query Description: Finds jobs whose required skills semantically match the candidate skills and labels the match type.

Other Queries:
- ALL_SKILLS lists skills with aliases and relationships.
- ALL_JOBS lists jobs with organizations, locations, and required skills.
- JOBS_BY_SKILL returns jobs requiring a given skill or related skills.
- SIMILAR_SKILLS returns semantic neighbors via similar, equivalent, broader, and narrower relations.
- ONTOLOGY_STATS reports counts of skills, jobs, organizations, and relationships.
Example invalid data caught by SHACL: a job with no `sm:jobTitle` or no `sm:requiresSkill` is rejected; a skill without `sm:skillName` is rejected; a person without `sm:hasSkill` is rejected.

CODE (Prompt used for LLM generation):
Code Function: `lib/rdf/semantic-matcher.ts` computes semantic matches between resume-extracted skills and job required skills, applies weights, dedupes by required skill, normalizes score, and returns reasons; `/api/match` filters to scores >=50.

Final Generation Prompt: “Implement a semantic matcher that, given candidate skill IDs and job postings with required skills, uses ontology relations (exact/equivalent/broader/narrower/similar) with weights to score and sort jobs, returning matched skill details, reasons, and normalized scores.”

Link to Code: `lib/rdf/semantic-matcher.ts`, `lib/rdf/neo4j-store.ts`, `lib/rdf/sparql.ts`, `app/api/match/route.ts`
Code Repository: https://github.com/<your-username>/SkillSync

Agentic AI:
Framework: None in current version.

Description of Agent Use: N/A. *Next version:* add an RAG agent to suggest upskilling resources and adjust skill weights interactively before matching.

Future Next-Level Upgrade: Connect to external job APIs and scrape postings to auto-populate the graph; use an agentic AI to expand and normalize new technical specializations while continuously updating the ontology and SHACL shapes; and keep feedback-tuned weights with concise reasoning visible in the UI for transparency.

Other: Added SHACL validation on load, Neo4j/n10s initialization with Cypher fallback, word-boundary skill extraction, and score thresholding (>50%) in `/api/match`.

Validation and demo metrics: SHACL pass rate on ingested data; precision@10 of matches on curated profiles; latency per match request; and manual spot-checks that ONTOLOGY_STATS reflects expected counts after API/job ingestions.
