# Production CI/CD

The `CI/CD` GitHub Actions workflow runs the application build, Node test suite,
and Playwright browser tests for every pull request and push to `main`.

After all checks pass on `main`, the workflow uploads the exact commit to the
production server, builds a commit-tagged Docker image, replaces the running
container, waits for the Docker health check, and verifies the public HTTPS
endpoint. An unhealthy release automatically restores the previously active
release.

The workflow uses the GitHub `production` environment with these values:

- Variable `PRODUCTION_HOST`
- Variable `PRODUCTION_USER`
- Secret `PRODUCTION_SSH_KEY`
- Secret `PRODUCTION_KNOWN_HOSTS`

Production configuration remains only on the server at
`/opt/goldenevents/shared/.env.production`. Runtime event data remains in the
Docker volume `goldenevents_events_data` and is never included in a release.

To redeploy the latest `main` commit without making a new commit, run the
workflow manually from GitHub Actions.
