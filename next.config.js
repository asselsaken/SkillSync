/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Server-only packages that must not be bundled (WASM / native / CJS quirks)
    serverComponentsExternalPackages: ['oxigraph', 'pdf-parse', 'neo4j-driver', 'rdf-validate-shacl'],
    // Ship the ontology files with the serverless functions (e.g. on Vercel)
    outputFileTracingIncludes: {
      '/api/**/*': ['./ontology/**/*'],
    },
  },
}

module.exports = nextConfig
