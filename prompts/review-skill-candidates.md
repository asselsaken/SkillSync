# Review skill candidates for the SkillMatch knowledge graph

You are curating the skill ontology of SkillMatch, a job-matching app. A script
found terms that job postings list next to known skills but that the graph does
not contain yet. Decide which are real skills and how they fit the graph.

## Inputs

- `data/skill-candidates.json`: candidates with posting counts, the known skills
  they are listed with, and example lines from postings
- `ontology/skills.rdf.ttl` and `ontology/skills-learned.rdf.ttl`: the current skills
  (ids after `skill:`, names, aliases, relations)
- `data/skill-proposals/`: earlier review batches; don't propose anything already there

## Output

Write one new file `data/skill-proposals/<YYYY-MM-DD>.json` (today's date; add
`-2`, `-3`… if that name exists) in exactly this shape:

```json
{
  "reviewedAt": "YYYY-MM-DD",
  "reviewer": "Claude Code (skill review)",
  "newSkills": [
    {
      "id": "apache-kafka",
      "name": "Kafka",
      "aliases": ["apache kafka"],
      "broader": ["data-engineering"],
      "similar": ["flink"],
      "equivalent": [],
      "caseSensitive": false,
      "description": "Distributed event streaming platform",
      "evidencePostings": 127
    }
  ],
  "newAliases": [
    { "skill": "rag", "aliases": ["retrieval-augmented generation"] }
  ],
  "rejected": [
    { "term": "YouTube", "reason": "Company product, not a skill" }
  ]
}
```

Then run `npm run graph:apply -- --check` and fix the file until it reports no
problems. Do not edit any other file.

## Rules

**Accept** a candidate when it is a concrete, learnable technical skill a
candidate could list on a résumé: a language, framework, library, database,
cloud service, tool, protocol or established technique.

**Reject** (list it under `rejected` with a short reason):
- company, team or product names that aren't technologies people learn
  (e.g. a company's internal product)
- generic words, soft skills, roles, degrees, verbs, section headings
- fragments of a longer phrase, and vendor marketing terms

**If the candidate is another spelling of a skill that already exists**, don't
create a new skill: add the spelling under `newAliases` for that skill.

**Names and aliases**
- `name` is the usual written form ("PostgreSQL", "Kafka", "gRPC").
- Aliases are other spellings people actually write, in lower case, up to 8.
  Every alias must be unique across the whole graph.
- If the name is also an ordinary English word ("Go", "Rust", "Swift", "Ray",
  "Airflow"), set `"caseSensitive": true` so only the capitalised name matches,
  and give unambiguous aliases ("golang", "apache airflow"). Never use an
  ordinary word as an alias.
- `id` is lower-case-hyphenated and must not already exist.

**Relations** (use ids of existing skills, or of skills added in the same batch)
- `broader` is required: the most specific existing parent. Prefer concrete
  parents like `programming-languages`, `databases`, `nosql-databases`, `devops`,
  `ci-cd`, `cloud-platforms`, `data-engineering`, `big-data`, `ml-libraries`,
  `deep-learning-frameworks`, `frontend-frameworks`, `backend-development`.
- `similar`: skills a hiring manager would accept as close substitutes
  (Kafka ≈ Pulsar, Terraform ≈ Pulumi). Use sparingly: a wrong "similar"
  link gives candidates credit they shouldn't get.
- `equivalent`: only for true synonyms that must stay separate skills. Usually
  an alias is the better choice.

**Evidence**: copy `postings` from the candidate into `evidencePostings`.

Be conservative. A missed skill can be added in the next review; a wrong skill
or relation changes everyone's match scores.
