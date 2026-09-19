# Local resident memory

The local preview uses Neo4j Community 5.26.0 and Temurin Java 21 under `.local-memory/`. Neo4j listens only on localhost, with HTTP on 7474 and Bolt on 7687. Credentials are in the ignored `.env`; do not commit them. Database files persist in `.local-memory/neo4j/data`.

Start an installed runtime with `scripts/start-local-memory.sh`, then start the backend from the repository root so it loads `.env`. Check `/health` for `memory_configured: true`; exercise a memory endpoint to confirm connectivity as well.

For a new checkout, install the official [Neo4j Community archive](https://dist.neo4j.org/neo4j-community-5.26.0-unix.tar.gz) into `.local-memory/neo4j` and [Temurin Java 21](https://adoptium.net/temurin/releases/?version=21) into `.local-memory/java`. Configure Neo4j to listen on `127.0.0.1`, set an initial password with `neo4j-admin dbms set-initial-password`, and add `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `NEO4J_DATABASE` to `.env`.

Verification: `cargo test -p simfrancisco --test memory_neo4j` checks actual database writes, recall, date boundaries, and workspace isolation. The database must be running and `.env` configured; otherwise this integration test skips its live assertions.
