# Contributing to StreamPay Backend

Thank you for your interest in contributing to the StreamPay Backend! As a Web3-focused payment infrastructure, we maintain high standards for security, stability, and documentation.

## Quick Start
1. **Fork & Clone**: Fork the repository and create your feature branch: `git checkout -b feat/your-feature`.
2. **Node Version**: Ensure you are using **Node.js v18.x or higher** (check via `node -v`).
3. **Environment**: Run `npm install` to sync dependencies.
4. **Secret Management**: **Never** commit `.env` files or hardcode Stellar Secret Keys. Use the provided `.env.example`.

## Development Guidelines
* **Architecture**: Refer to `docs/ARCHITECTURE.md` and our OpenAPI spec in `src/openapi.yaml`.
* **Linting**: Run `npm run lint` before every commit.
* **Testing**: We require **95% test coverage** for new logic. Run `npm test` to verify.
* **Branch Naming**: Use `feat/`, `fix/`, or `docs/` prefixes.

## Pull Request Checklist
- [ ] Code follows TypeScript best practices.
- [ ] Unit/Integration tests cover edge cases.
- [ ] Documentation/OpenAPI spec updated.
- [ ] Branch is rebased against `main`.

## Security
If you find a security vulnerability, please do not open a public issue.
Instead, report it privately by emailing the maintainers so we can issue a
fix before public disclosure.

## Commit Messages
We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` a new user-facing feature
- `fix:` a bug fix
- `docs:` documentation-only changes
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding or improving tests
- `chore:` tooling, configuration, or dependency changes

Keep the subject line under 72 characters and prefer the imperative mood
("add", "fix", "remove" — not "added", "fixes").

---
*Built for the Stellar Ecosystem.*
