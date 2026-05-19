# pi-codex-accounts

Switch between multiple ChatGPT/Codex OAuth accounts from Pi or Oh My Pi.

## Install

```bash
pi install npm:pi-codex-accounts
```

For local development in Oh My Pi, add the source extension path to `~/.omp/agent/config.yml`:

```yaml
extensions:
  - /path/to/pi-extensions/packages/pi-codex-accounts/src/index.ts
```

## Usage

```text
/codex-account
/codex-account work
```

Use `+ Add ChatGPT/Codex account` in the picker to start OpenAI device-code auth. Account aliases are stored in `codex-accounts.json` under the active agent directory; OAuth credentials remain in the agent auth store.

You can predeclare aliases with:

```bash
PI_CODEX_ACCOUNTS=work,personal pi
```
