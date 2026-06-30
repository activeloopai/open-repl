# PRD — Multi-agent engine on the Claude Agent SDK

**Status:** draft for parallel implementation
**Owner:** Emanuele Fenocchi
**Scope:** replace the hand-rolled multi-agent layer (`packages/server/src/agent/orchestrator.ts`, `subagents.ts`, `runtime.ts`) with an engine built on Anthropic's **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`). Everything else in the product stays as-is.

---

## 1. Why

Today the multi-agent system is a hand-written "agents-as-tools" loop on top of the Vercel AI SDK:

- `orchestrator.ts` — the Orchestrator exposes `delegate_to_planner/coder/reviewer` as tools and reads each sub-agent's final text (`packages/server/src/agent/orchestrator.ts:42-86`).
- `subagents.ts` — three roles (`planner`, `coder`, `reviewer`), each a system prompt + a subset of tool names (`packages/server/src/agent/subagents.ts:15-50`).
- `runtime.ts` — one `streamText` loop, provider-agnostic, shared by every role (`packages/server/src/agent/runtime.ts:27-69`).

We are migrating the **multi-agent path** to the Claude Agent SDK because:

1. **Native multi-agent.** The SDK delegates to subagents through the built-in `Agent` tool; we stop maintaining our own orchestration loop, handoff plumbing, and step caps.
2. **Per-role model tiers out of the box.** `AgentDefinition.model` accepts `'haiku' | 'sonnet' | 'opus' | 'fable' | 'inherit'`, so cheap roles run on Haiku and hard roles on Opus/Sonnet with no extra code.
3. **Subscription economics.** Anthropic-subscription users (auth via the local Claude credential) pay nothing per token for the agent layer — the same value proposition the existing Codex provider gives for ChatGPT. **See the §8 risk before relying on this commercially.**
4. **Battle-tested context management, hooks, permissions, sessions** — the same machinery that powers Claude Code, instead of our `BudgetGuard` + `maxSteps`.

OpenRouter stays as the **"bring your own model"** escape hatch on the existing AI-SDK path; it is not deleted.

---

## 2. Non-goals

- No change to the WebSocket protocol (`@openrepl/shared`), the Canvas/Web UI, workspace FS, preview proxy, secrets, or the workflow/app-runner subsystem.
- No change to the OpenRouter path beyond what's needed to coexist with the new engine.
- Codex provider: **untouched** (remains the scaffold it is today).
- No hosted/multi-tenant deployment in this milestone — local, self-hosted only (consistent with the project's "tutto locale, niente Docker" stance).

---

## 3. Verified SDK facts (grounding)

All confirmed from `https://code.claude.com/docs/en/agent-sdk/*` (June 2026).

| Capability | API surface |
|---|---|
| Package / entry | `@anthropic-ai/claude-agent-sdk`; `query({ prompt, options }) → AsyncGenerator<SDKMessage>` |
| Streaming input | `prompt` accepts `string \| AsyncIterable<SDKUserMessage>` |
| Model selection | `options.model` (alias or full ID); `options.fallbackModel`; `q.setModel()` mid-session |
| Subagents | `options.agents: Record<string, AgentDefinition>`; delegated via the built-in `Agent` tool → include `"Agent"` in `allowedTools` to auto-approve |
| `AgentDefinition` | `{ description, prompt, tools?, disallowedTools?, model?, effort?, maxTurns?, permissionMode?, mcpServers?, skills? }` |
| Per-role model | `AgentDefinition.model: 'haiku' \| 'sonnet' \| 'opus' \| 'fable' \| 'inherit' \| <full-id>` |
| Custom tools | `tool(name, description, zodShape, handler)` + `createSdkMcpServer({ name, tools })` → in-process MCP, no subprocess |
| Built-in tools | `Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Monitor` |
| Permissions | `options.permissionMode` (`default\|acceptEdits\|bypassPermissions\|plan\|dontAsk\|auto`); `options.canUseTool(toolName, input, ctx) → {behavior:'allow'\|'deny'}` |
| Hooks | `options.hooks` (`PreToolUse, PostToolUse, Stop, SessionStart, …`) |
| System prompt | `options.systemPrompt: string \| { type:'preset', preset:'claude_code', append? }` |
| Filesystem config | `options.settingSources: ('user'\|'project'\|'local')[]` — **default loads `.claude/`; set `[]` to isolate** |
| Subagent detection | `tool_use` blocks where `name === "Agent"` (older: `"Task"`); subagent messages carry `parent_tool_use_id` |
| Auth | env `ANTHROPIC_API_KEY`; also Bedrock/Vertex/Azure/AWS via `CLAUDE_CODE_USE_*` |

---

## 4. Target architecture

### 4.1 Engine abstraction

Introduce a small engine interface so the session layer is agnostic to which backend runs a turn:

```
packages/server/src/agent/
  engine.ts            # AgentEngine interface (run a turn → stream UiEvents → RunResult)
  claude/
    engine.ts          # ClaudeAgentEngine — wraps query() from @anthropic-ai/claude-agent-sdk
    roles.ts           # AgentDefinition map (orchestrator + planner/coder/reviewer) + model tiers
    tools.ts           # createSdkMcpServer wrapping workspace/shell/run_app (the 6 OpenREPL tools)
    map-messages.ts    # SDKMessage → UiEvent (agent_token / agent_tool_call / agent_tool_result)
  aisdk/
    runtime.ts         # the EXISTING Vercel AI SDK loop (moved here, unchanged) — OpenRouter/Codex
    orchestrator.ts    # EXISTING hand-rolled multi-agent (kept for non-Claude multi-agent, or retired — see §7)
  guards.ts            # unchanged
  probe.ts             # unchanged (run_app)
```

`session.ts` picks the engine from `config.provider`:

- `provider === 'claude'` → `ClaudeAgentEngine` (multi-agent native, default).
- `provider === 'openrouter' | 'codex'` → existing AI-SDK path.

### 4.2 Roles → `AgentDefinition`

Re-express the three existing roles as SDK subagents, preserving their current prompts and tool subsets (from `subagents.ts:15-50`), and assigning model tiers:

| Role | Model tier (default) | Tools | Source prompt |
|---|---|---|---|
| orchestrator (main thread) | `sonnet` | `Agent` + read-only | `ORCHESTRATOR_SYSTEM` (`subagents.ts:45`) |
| planner | `haiku` | `read_file, list_dir, search_repo` | planner prompt (`subagents.ts:19`) |
| coder | `opus` | `read_file, write_file, list_dir, search_repo, run_command, run_app` | coder prompt (`subagents.ts:26`) |
| reviewer | `sonnet` | `read_file, list_dir, search_repo, run_command, run_app` | reviewer prompt (`subagents.ts:37`) |

Tiers are **config-overridable** per role (reuse the existing `config.models` per-role map surfaced in `session.ts:254`). Default mapping encodes the user's intent: Haiku for weak/cheap roles, Opus/Sonnet for strong roles.

### 4.3 Tools — preserve live UI

The crown-jewel behaviors (live editor sync, streamed terminal, the `run_app` self-healing loop) depend on writes going through `workspace.writeFile` and commands through the existing `CommandRunner`/probe. Therefore **do not** rely on the SDK's built-in `Write`/`Bash`; instead expose the existing six tools as in-process MCP tools via `createSdkMcpServer`, wrapping the exact `ToolDeps` already built in `session.ts:286-294`:

- `read_file, write_file, list_dir, search_repo` → `workspace.*`
- `run_command` → `CommandRunner` (+ the existing allowlist, enforced in `canUseTool` or inside the handler)
- `run_app` → `probeApp` (the run → observe → fix loop; `agent/probe.ts:19`)

Set `settingSources: []` and an explicit `allowedTools` (the six tool names + `"Agent"`) so no `.claude/` config leaks in and the built-in Write/Bash are not used. Map the command allowlist (`config.commandAllowlist`, `tools.ts:12-15`) into `canUseTool`.

### 4.4 Events & usage

- Translate `SDKMessage` → existing `UiEvent`s in `map-messages.ts`: assistant text → `agent_token`; `tool_use` → `agent_tool_call`; tool result → `agent_tool_result`; subagent activity tagged via `parent_tool_use_id` (so sub-agent file writes still appear live, matching `orchestrator.ts:63-65`).
- Usage/cost: read the final result message's usage/cost fields and feed `makeUsageRecord` (`session.ts:356`). For subscription auth, per-token cost is $0 — record it like the existing `planUnits` currency so the dashboard's two-currency model still holds. **Verify exact result-message field names against the SDK message-types reference during implementation — do not assume.**
- Abort: wire the existing `AbortController` (`session.ts:281-282`) to the SDK (abort the `query` async iterator / pass the signal) so the Stop button still kills a run.

---

## 5. Auth & configuration

- Default: `ANTHROPIC_API_KEY` from the workspace `.env` via the existing `Secrets` manager (same pattern as `OPENROUTER_API_KEY` in `registry.ts:11-13`).
- Subscription/local-credential auth: the SDK reads the local Claude credential when no API key is set. Treat exactly like the Codex "flat subscription" provider (read-only use of an existing login). **Gated by §8 risk.**
- New provider id `'claude'` added to `ProviderId` in `@openrepl/shared`, registered in `providers/registry.ts`, default model tiers in config.

---

## 6. Acceptance criteria (end-to-end, not "code compiles")

1. With `provider='claude'` and a valid Anthropic credential, sending "create a Flask app and make it run" drives orchestrator → planner(Haiku) → coder(Opus) → reviewer(Sonnet), files appear live in the editor, and `run_app` reports the app serving — verified by the existing smoke test (`scripts/smoke.ts`) extended for the Claude engine.
2. The run → fix → run self-healing loop still closes: an intentionally broken first attempt is corrected until `run_app` returns `ok:true`.
3. Stop button aborts an in-flight Claude run within ~1s, no orphan processes (parity with `session.ts:84-86`).
4. Usage dashboard records the run (cost for API-key, plan-units/zero-cost for subscription).
5. OpenRouter single-agent path still works unchanged (regression guard).
6. `settingSources: []` confirmed — no host `~/.claude/` config bleeds into a user's agent run.

---

## 7. Open design decisions (decide before/early in build)

1. **Non-Claude multi-agent.** Keep the legacy hand-rolled orchestrator for OpenRouter multi-agent, or make multi-agent Claude-only and OpenRouter single-agent-only? (Leaning: Claude-only multi-agent; OpenRouter = single-agent override. Simpler, matches stated intent.)
2. **Tools: custom-MCP vs built-ins + watcher.** Custom MCP (chosen above) preserves terminal streaming and `run_app`. Revisit only if streaming the SDK's `Bash` output into xterm proves clean.
3. **Result-message cost fields** — confirm names against the SDK message-types reference (§4.4).

---

## 8. Risks

1. **Subscription auth IS supported for individual self-hosted use — with boundaries.** Per Anthropic's support article *"Use the Claude Agent SDK with your Claude plan"* (`https://support.claude.com/en/articles/15036540`): *"Claude subscription plans are now eligible to receive a monthly Agent SDK credit. This credit covers Claude Agent SDK usage."* So a user running OpenREPL locally with their own Claude plan is the intended path. Boundaries to respect:
   - **Per-user, not pooled** — *"can't be shared or pooled across teammates."* One plan ≠ many users.
   - **Shared/production automation** — *"Teams running shared production automation should use Claude Platform with an API key for predictable pay-as-you-go billing."*
   - **Hosted product offering claude.ai login to your end-users** — the SDK overview note (*"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login… for their products"*) applies to a service **you host** for others; needs prior Anthropic approval.
   - **June 15, 2026 update paused the credit changes** — *"for now, nothing has changed: Claude Agent SDK usage still draws from your subscription's usage limits."* Track this; it may change.

   **Decision (per product owner):** subscription is the **default** for the single local user (matches the cost-saving pitch); **API key** for any shared/hosted/multi-tenant deployment. Support both at runtime.
2. **Provider lock-in.** The Agent SDK loop is Claude-native; OpenRouter/other models cannot run *through* it without a gateway. Hence the dual-engine design (§4.1) rather than routing everything through the SDK.
3. **Terms of Service.** Use is governed by Anthropic's Commercial Terms, including when powering a product for end users — review before shipping commercially.
4. **Model-ID drift.** Use aliases (`haiku`/`sonnet`/`opus`) not pinned dated IDs, to avoid retirement breakage.

---

## 9. Parallelization plan (agents teams)

Independent surfaces for `agents teams` (boundary contracts in §4.1 paths):

- **Track A — engine core:** `agent/engine.ts` + `agent/claude/engine.ts` + `map-messages.ts`. Owns the `query()` integration and event mapping.
- **Track B — roles & tools:** `agent/claude/roles.ts` + `agent/claude/tools.ts`. Owns `AgentDefinition`s, model tiers, and the in-process MCP tool wrappers.
- **Track C — wiring & config:** `session.ts` engine switch, `providers/registry.ts` + `@openrepl/shared` `ProviderId`, config defaults. Depends on A/B interfaces (sequence with `--after`).
- **Track D — tests:** extend `scripts/smoke.ts` + unit tests per new file (1:1). Verifies acceptance criteria §6.

Shared dependency: the `AgentEngine` interface in `engine.ts` is the single contract — Track A owns it, B/C/D import it.
