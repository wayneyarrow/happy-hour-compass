# Happy Hour Compass Developer Setup

This is the official developer setup guide for Happy Hour Compass. It is written to be sufficient on its own: following it start to finish recreates the complete development environment from scratch on a new machine, without relying on memory or prior conversation history.

---

## 1. Overview

The Happy Hour Compass development environment is built around:

- **VS Code** — primary editor
- **Claude Code** — AI pair-programmer, run from the VS Code sidebar and CLI
- **Git** — version control
- **GitHub CLI (`gh`)** — pull requests, issues, repository operations
- **Supabase CLI** — local database tooling and migrations
- **Vercel CLI** — deployment tooling
- **Node.js** — JavaScript/TypeScript runtime for the Next.js app
- **MCP (Model Context Protocol)** — connects Claude Code directly to project services (currently: Supabase, read-only)

This document is the single source of truth for setting up that environment. If a setup step is unclear or missing, this document should be updated rather than relying on memory or chat history.

---

## 2. Philosophy

This environment is intentionally designed to maximize developer productivity while minimizing complexity. That intent is reflected in a small set of guiding principles applied throughout this document:

- Prefer official tooling.
- Keep configuration project-scoped wherever practical.
- Never commit secrets.
- Prefer repository configuration over machine-wide configuration when appropriate.
- Keep AI configuration reproducible.
- Document setup changes as they are made.

---

## 3. Repository

Repository root:

```
~/happy-hour-compass
```

**The repository root — not `operator-admin` — is the VS Code workspace.**

Why: the repository contains more than the Next.js app. `operator-admin/` holds the active application, but `supabase/` (shared database migrations) and `docs/` live at the repository root and apply across the whole project. Opening `operator-admin` alone hides these from the editor, from Claude Code's project context, and from search. Opening only `operator-admin` also reduces the repository context available to Claude Code itself, limiting its visibility into shared migrations, cross-cutting documentation, and root-level configuration when reasoning about the codebase. Opening the repository root keeps the app, the shared Supabase migrations, and the documentation all visible and navigable together.

---

## 4. Required Software

- **VS Code**
- **Node.js**
- **Git**
- **GitHub CLI**
- **Supabase CLI**
- **Vercel CLI**
- **Claude Code**

Installation (macOS, via Homebrew, where applicable):

```bash
# VS Code
brew install --cask visual-studio-code

# Node.js
brew install node

# Git
brew install git

# GitHub CLI
brew install gh

# Supabase CLI
brew install supabase/tap/supabase

# Vercel CLI
npm install -g vercel

# Claude Code
curl -fsSL https://claude.ai/install.sh | bash
```

If prompted, add `~/.local/bin` to your PATH using the command provided by the installer.

---

## 5. Initial Authentication

Authenticate each CLI once per machine. Do not store any secrets in the repository.

**GitHub CLI**
```bash
gh auth login
```

**Vercel CLI**
```bash
vercel login
```

**Supabase CLI**
```bash
supabase login
```

**Claude Code**
```bash
claude
```
Claude Code will prompt for authentication (Claude Pro/Max or Console login) on first run.

---

## 6. VS Code Workspace

Preferred layout:

```
Explorer      | Editor              | Claude
(full height) |                     | (full height)
              |---------------------|
              | Terminal            |
              | (bottom only)       |
```

- **Explorer** — full height, left column
- **Claude** (sidebar) — full height, right column
- **Terminal** — bottom of the editor column only (not full width)

This keeps file navigation and the Claude sidebar always visible, while the terminal stays scoped under the editor rather than displacing either.

---

## 7. Startup Workflow

Add this alias to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
alias hhc="cd ~/happy-hour-compass && code ."
```

Daily startup is then a single command:

```bash
hhc
```

This opens the repository root as the VS Code workspace (see Section 3).

---

## 8. Claude Code Configuration

Three configuration files govern Claude Code's behavior in this project. They intentionally separate three distinct concerns — shared project configuration, project MCP configuration, and developer-specific local secrets — so each can be committed, or excluded from commit, appropriately:

- **`.claude/settings.json`** — project-level, committed to git. Defines the shared permissions deny list (see Section 11) that applies to every developer working in this repository.
- **`.claude/settings.local.json`** — personal, per-machine overrides, including environment variables such as the Supabase MCP access token. **Intentionally gitignored** — it is never shared or committed, since it may hold per-developer secrets.
- **`.mcp.json`** — project-level, committed to git. Declares which MCP servers are available in this project (currently: Supabase, read-only). Contains no secrets itself; it references environment variables (e.g. `${SUPABASE_ACCESS_TOKEN}`) that are supplied by `.claude/settings.local.json`.

---

## 9. Supabase MCP

The project uses the **official Supabase MCP server**, configured as:

- **Project scoped** — locked to this project's Supabase ref, so Claude cannot act against unrelated Supabase projects.
- **Read-only** — the MCP server exposes no mutating tools (no inserts, updates, deletes, or migrations) to Claude.

**Why read-only:** Claude Code is used heavily for exploration, debugging, and answering questions about live data and schema. Read-only access lets Claude inspect the database freely without any risk of an unintended write. Schema and data changes continue to go through reviewed Supabase migrations, not through the MCP connection.

**Creating a dedicated Personal Access Token (PAT):**

1. Go to the [Supabase dashboard → Account → Access Tokens](https://supabase.com/dashboard/account/tokens).
2. Create a new token with a clearly identifiable name (e.g. `claude-code-mcp`) — do not reuse a token from another tool.
3. Copy the token value immediately; it will not be shown again.

**Where to store it:** `.claude/settings.local.json`, under the `env` block, as `SUPABASE_ACCESS_TOKEN`. This file is gitignored (Section 8) and never leaves your machine.

Do not paste the token into chat, commit messages, or any tracked file.

---

## 10. AI Workflow

Our development process moves from product direction through to a committed change:

```
ChatGPT
  ↓
Architecture / Planning
  ↓
Claude Task
  ↓
Claude (VS Code sidebar)
  ↓
Implementation
  ↓
Implementation Summary
  ↓
Testing / QA
  ↓
Commit
```

In this workflow, ChatGPT acts as the product owner and architect, while Claude acts as the implementation engineer. **ChatGPT** is used for product direction and architecture — deciding *what* to build and *why*. **Claude** is used for implementation — turning an agreed plan into working code inside the actual repository, with full project context.

---

## 11. Safety

- **Destructive command deny list** — `.claude/settings.json` blocks Bash invocations of force pushes, hard resets, forced cleans, force branch deletes, recursive force removes, and destructive Supabase CLI operations (e.g. `db reset`, `projects delete`).
- **Why it exists** — these operations are either irreversible or affect shared/remote state. Blocking them at the configuration level means a single bad command or misunderstanding can't destroy work, regardless of what is asked of Claude in a given session.
- **Project-scoped configuration** — the deny list lives in `.claude/settings.json`, committed to git, so it applies uniformly to every developer and every machine working in this repository.
- **Secrets are never committed** — access tokens and credentials live only in gitignored files (`.claude/settings.local.json`) or environment variables, never in tracked files, commit messages, or documentation.

---

## 12. Recovery

To rebuild the development environment on a new machine:

1. **Install required software** — VS Code, Node.js, Git, GitHub CLI, Supabase CLI, Vercel CLI, Claude Code (Section 4).
2. **Clone the repository**:
   ```bash
   git clone <repository-url> ~/happy-hour-compass
   ```
3. **Authenticate GitHub CLI, Vercel CLI, Supabase CLI, and Claude Code** (Section 5).
4. **Create `.claude/settings.local.json`** locally (gitignored, not part of the clone) (Section 8).
5. **Add the dedicated Supabase PAT** to that file (Section 9).
6. **Add the `hhc` alias** to your shell profile (Section 7).
7. **Open the repository root** as the VS Code workspace (Section 3).
8. **Verify Supabase MCP connectivity** (see checklist, Section 13).
9. **Run `hhc`** and confirm the preferred workspace layout opens correctly (Section 6).

---

## 13. Verification Checklist

☐ VS Code opens correctly
☐ Claude sidebar works
☐ Claude Code authenticated
☐ GitHub CLI authenticated
☐ Supabase CLI authenticated
☐ Vercel CLI authenticated
☐ Supabase MCP connected
☐ `hhc` alias works
☐ Project opens at repository root
☐ No secrets committed

---

## 14. Updating This Document

Whenever the developer environment changes:

- Update this document in the same commit when practical.
- Keep it synchronized with the actual repository and tooling.
- Do not rely on chat history or memory as the source of truth.
