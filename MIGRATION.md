# Migration Guide: MCP 2025-11-25 → 2026-07-28

This guide covers every breaking change between the two MCP protocol revisions, with before/after code examples from this project. If you're coming from tutorials or blog posts written before mid-2026, this is what changed and why.

## TL;DR

The 2026-07-28 revision makes MCP **stateless**. No sessions, no handshake, no server-side connection state. Every request carries everything the server needs in `_meta`. This simplifies deployment (serverless-friendly), eliminates reconnection bugs, and aligns with how HTTP actually works.

## Breaking Changes

### 1. Stateless Protocol — No More `initialize`/`initialized`

**Before (2025-11-25):** Client and server performed a handshake to establish a session.

```typescript
// Old: Client had to initialize first
const client = new Client({ name: 'my-client', version: '1.0.0' });
await client.connect(transport);
// transport sent initialize → server replied → client sent initialized
// THEN you could call tools
```

**After (2026-07-28):** Every request includes `_meta` with protocol version, client info, and capabilities. No handshake needed.

```typescript
// New: Just start making requests
// Each request carries _meta: { protocolVersion, clientInfo, clientCapabilities }
// The SDK handles this transparently
```

**Why:** Stateless = serverless-friendly. No session to maintain, no reconnection logic, no "session expired" errors. Each request is independent.

### 2. `Mcp-Session-Id` Header — Removed

**Before:** Server assigned a session ID, client sent it on every request.

**After:** Gone. Each request is self-contained. The `_meta` envelope replaces session state.

### 3. MRTR Replaces Sampling, Roots, and Elicitation

**Before (2025-11-25):** Three separate server-initiated patterns:
- `sampling/createMessage` — server asks client to make an LLM call
- `roots/list` — server asks client for filesystem roots
- `elicitation/create` — server asks client for user input

```typescript
// Old: Server pushed an elicitation request and awaited the client's reply
server.tool('delete_project', schema, async (args) => {
  // Server-initiated — the server drives, then blocks on the round-trip.
  // (Exact 1.x method surface omitted; the point is the direction of control.)
  const response = await /* server-initiated elicitation */({
    message: 'Are you sure?',
    requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
  });
  if (response.content?.confirm) {
    // proceed with deletion
  }
});
```

**After (2026-07-28):** MRTR (Multi Round-Trip Requests) unifies all three. The server returns `inputRequired()`, the client retries with `inputResponses`.

```typescript
// New: MRTR pattern
server.tool('delete_project', schema, async (args, ctx) => {
  // Check if client already provided the answer (retry with inputResponses)
  const response = ctx.mcpReq.inputResponses?.confirm;
  if (!response) {
    // First call — ask for confirmation
    return ctx.mcpReq.inputRequired({
      confirm: {
        method: 'elicitation/create',
        params: {
          message: `Delete project and all issues? This cannot be undone.`,
          requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
        },
      },
    });
  }

  // IMPORTANT: Always check action first, not content truthiness
  if (response.action !== 'accept') {
    return { content: [{ type: 'text', text: 'Deletion cancelled.' }] };
  }

  // Proceed with deletion
  await store.deleteProject(args.project_id);
  return { content: [{ type: 'text', text: 'Project deleted.' }] };
});
```

**Key lesson learned:** Always branch on `response.action` (`accept`/`decline`/`cancel`) before checking `response.content`. Checking `content` truthiness on a `decline` causes infinite re-issue loops because the server keeps asking.

**Why:** One pattern instead of three. The client drives the interaction (retry with answers), not the server (push a request and wait). This is fundamentally more compatible with stateless HTTP.

### 4. Tasks Extension → Progress Notifications

**Before (2025-11-25):** The Tasks extension provided polling-based progress tracking.

```typescript
// Old: Tasks — server creates a task, client polls for status
server.tool('generate_report', schema, async (args) => {
  const task = await server.createTask({ status: 'running' });
  // ... do work, update task.progress ...
  task.complete(result);
  return { _meta: { 'io.modelcontextprotocol/tasks': { id: task.id } } };
});

// Client polled: tasks/get { id: "task-abc" }
```

**After (2026-07-28):** Tasks is **@deprecated** (2025-11-25 wire vocabulary with no SDK runtime). Use `notifications/progress` with `progressToken` instead.

```typescript
// New: Progress notifications — streaming, not polling
server.tool('generate_sprint_report', schema, async (args, ctx) => {
  const progressToken = ctx.mcpReq._meta?.progressToken;

  // Emit progress as you go
  if (progressToken) {
    await ctx.mcpReq.notify({
      method: 'notifications/progress',
      params: { progressToken, progress: 10, total: 100, message: 'Gathering issues...' },
    });
  }

  // ... do work ...

  if (progressToken) {
    await ctx.mcpReq.notify({
      method: 'notifications/progress',
      params: { progressToken, progress: 80, total: 100, message: 'Generating report...' },
    });
  }

  return { content: [{ type: 'text', text: report }] };
});
```

**Why:** Progress notifications are streaming (server pushes updates as they happen) vs. polling (client asks "are we there yet?" repeatedly). More efficient, lower latency, simpler server code.

### 5. Push Notifications → `subscriptions/listen`

**Before (2025-11-25):** Server pushed notifications to all connected clients.

**After (2026-07-28):** Client explicitly opts into notifications via `subscriptions/listen`.

```typescript
// Server-side: publish events to the bus
bus.publish({ kind: 'resource_updated', uri: `tracker://${projectId}/board` });

// Client-side: subscribe to what they care about
// { method: "subscriptions/listen", params: {
//     notifications: {
//       toolsListChanged: true,
//       resourceSubscriptions: ["tracker://proj-1/board"]
//     }
// }}
```

**Why:** Explicit subscription prevents wasted bandwidth. In a multi-user system, not every client needs every notification.

### 6. Dynamic Client Registration → CIMD

**Before (2025-11-25):** Clients registered with the server via `register_client` endpoint.

**After (2026-07-28):** Client ID Metadata Documents (CIMD). The `client_id` is a URL pointing to a JSON metadata document.

For resource servers (what this project is), the only obligation is **not choking on URL-shaped `client_id` values**. Fetching and validating the CIMD is the Authorization Server's job, not the RS's.

### 7. HTTP+SSE Transport → Streamable HTTP

**Before (2025-11-25):** Separate endpoints, SSE for server-to-client streaming.

**After (2026-07-28):** Single `/mcp` endpoint. Streamable HTTP uses standard HTTP semantics. POST for requests, SSE only when the client opts in for server-initiated messages.

### 8. Cacheable List Results (New)

Not a breaking change — additive. Servers can declare cache hints for list operations:

```typescript
const server = new McpServer(
  { name: 'issue-tracker', version: '1.0.0' },
  {
    cacheHints: {
      'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' },   // tools rarely change
      'prompts/list': { ttlMs: 3_600_000, cacheScope: 'public' },
      'resources/list': { ttlMs: 60_000, cacheScope: 'private' },  // per-user
    },
  },
);
```

- `cacheScope: 'public'` — same for all users (tools, prompts)
- `cacheScope: 'private'` — varies per user (resources scoped by membership)

Only surfaced to 2026-era connections. The SDK handles the version check.

### 9. Header-Based Routing (New)

Every Streamable HTTP request includes headers:
```
Mcp-Method: tools/call
Mcp-Name: create_issue
```

This enables gateway-level routing and metering without parsing the JSON-RPC body. Automatically handled by the SDK — no server-side code needed, but worth understanding for infrastructure.

### 10. Era Detection

**Key concept:** The protocol era is determined by the handshake path, not the transport. A stdio connection and an HTTP connection can both be 2025-era or 2026-era. The SDK's `createMcpHandler` detects which era the client speaks and adapts accordingly, including a shim that translates MRTR into legacy elicitation for 2025-era clients.

## Quick Reference

| Old (2025-11-25) | New (2026-07-28) | What Changed |
|---|---|---|
| `initialize`/`initialized` handshake | `_meta` on every request | Stateless — no sessions |
| `Mcp-Session-Id` header | Removed | Each request is independent |
| `sampling/createMessage` | MRTR `inputRequired()` | Server returns result, client retries with input |
| `roots/list` | MRTR `inputRequired()` | Collect via elicitation if needed |
| `elicitation/create` (server-initiated) | MRTR `inputRequired()` | Unified pattern for all server→client input |
| Tasks extension (`tasks/get`, `tasks/cancel`) | `notifications/progress` + `progressToken` | Streaming progress replaces polling; Tasks is @deprecated |
| Push notifications | `subscriptions/listen` | Client opts into notification types |
| `notifications/message` (logging) | Deprecated | Use external logging |
| Dynamic Client Registration | CIMD | URL-based client metadata document |
| HTTP+SSE transport | Streamable HTTP | Single endpoint, stateless |
| N/A | Cacheable list results | `ttlMs` + `cacheScope` on list operations |
| N/A | Header-based routing | `Mcp-Method` / `Mcp-Name` headers |

## SDK Version Mapping

| Protocol | SDK Package | Version |
|---|---|---|
| 2025-11-25 | `@modelcontextprotocol/sdk` | 1.x |
| 2026-07-28 | `@modelcontextprotocol/server` + `@modelcontextprotocol/hono` | 2.x |

The v2 SDK split the monolithic `sdk` package into focused packages (`server`, `hono`, `client`). Import paths changed accordingly.
