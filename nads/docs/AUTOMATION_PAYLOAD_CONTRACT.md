# NADS → Cursor Automation payload contract

**Status:** P0 production-readiness (send remains gated by `NADS_AUTOMATION_ENABLED=false`).  
**Product:** Cursor Automations (webhook trigger), **not** ChatGPT Automations, **not** `POST /v1/agents`.

## Why a bridge exists

Cursor Automations accept a JSON POST to the generated webhook URL. Official guidance: a `context` field in the body is added to the agent prompt. **Arbitrary nested JSON is not guaranteed to become Composer context.**

NADS therefore sends:

```json
{
  "context": "<markdown brief for the Automation agent>",
  "nads": { /* structured AutomationDispatchPayload v1 */ }
}
```

Static Automation instructions in the Cursor UI **must** tell the agent to treat `context` as the full task brief (and may ignore or echo `nads`).

## Auth

```
Authorization: Bearer <NADS_AUTOMATION_WEBHOOK_KEY>
Content-Type: application/json
X-NADS-Idempotency-Key: dispatch:<taskId>:<attempt>
```

Cursor honor of `X-NADS-Idempotency-Key` is **not assumed**. NADS still uses it for local journal/event dedupe and avoids retrying ambiguous timeouts.

## `context` contents (Composer brief)

Built by `buildAutomationComposerContext()` / `buildAutomationWebhookBody()`:

- NADS task ID (`nads-task:<uuid>`)
- Title
- Full task prompt / description
- Acceptance criteria (numbered)
- Repository URL
- Starting git ref
- Requested branch prefix
- Correlation marker (must appear in PR body)
- Attempt / max attempts
- Prior rejection + required changes (when repairing)
- Explicit safety rules: draft PR only; do not touch `main`/production; no deploy/merge

## Structured `nads` object

Zod schema: `AutomationDispatchPayloadSchema` in `src/contracts/automation-payload.ts`.

| Field | Purpose |
|---|---|
| `taskId` | UUID correlation |
| `title` / `prompt` / `acceptanceCriteria` | Task content |
| `repoUrl` / `startingRef` | Repository identity |
| `correlation.nadsTaskMarker` | `nads-task:<uuid>` |
| `correlation.branchPrefix` | Preferred branch prefix |
| `idempotencyKey` | `dispatch:<taskId>:<attempt>` |
| `attempt` / `maxAttempts` | Retry budget |
| `priorRejection` / `requiredChanges` | Repair context |

## Suggested Automation static instructions

```text
You are the NEXORA NADS coding agent.
Read the webhook JSON `context` field as your complete task brief.
Obey every safety rule in that brief.
Include the exact nads-task marker in the draft PR body.
Prefer the requested branch prefix.
Do not merge to main or deploy.
```

## Completion plane

NADS does **not** rely on Cursor Automation callbacks for production completion.
Preferred: GitHub webhooks → NADS ingress → independent review.
Optional: signed NADS callback (`X-NADS-Signature`) if a bridge is configured.
