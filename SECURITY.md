# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| latest (`main`) | Yes |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Email security reports to: **abhinavhissar@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive a response within **48 hours**. If confirmed, a fix will be released as soon as possible and you will be credited in the release notes (unless you prefer to remain anonymous).

## Scope

Security issues we care about:

- SQL injection via the REST API
- Authentication/authorisation bypass
- Remote code execution
- Secrets leaking into logs or API responses
- Supply-chain issues in dependencies

## Out of scope

- Issues that require physical access to the machine
- Issues in third-party AI providers (Claude, Gemini, etc.) — report those to the respective vendor
- Self-XSS or social engineering

## Security best practices for self-hosters

- Always set a strong, unique `JWT_SECRET` — never use the default dev value in production
- Never expose port 3100 publicly without authentication in front of it
- Rotate API keys (Anthropic, Google) regularly
- Keep Docker and Node.js up to date
- Do not commit `.env` — it is in `.gitignore` by default
