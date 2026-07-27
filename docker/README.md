# Docker development scope

`docker-compose.yml` intentionally contains stateful local dependencies only: PostgreSQL, Redis, and Mailpit. Applications run through pnpm for fast workspace development and use the same production builds exercised by Playwright and CI.

Production container/image definitions are deployment-platform concerns and are not coupled to W1.
