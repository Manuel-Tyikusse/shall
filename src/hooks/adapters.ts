export type HookAdapter = "shall" | "codex" | "claude" | "cursor" | "gemini";

export interface HookCommand {
  command: string;
  cwd: string;
  agentLabel: string;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nestedString(value: unknown, key: string): string | undefined {
  return string(object(value)[key]);
}

/** Converts agent-specific pre-tool JSON into Shall's small shared protocol. */
export function normalizeHookInput(adapter: HookAdapter, raw: unknown): HookCommand {
  const input = object(raw);
  let command: string | undefined;
  let cwd: string | undefined;
  let agentLabel: string = adapter;

  switch (adapter) {
    case "shall":
      command = string(input.command);
      cwd = string(input.cwd);
      agentLabel = string(input.agent) ?? "coding-agent";
      break;
    case "codex":
      command = nestedString(input.tool_input, "command");
      cwd = string(input.cwd);
      agentLabel = "Codex";
      break;
    case "claude":
      command = nestedString(input.tool_input, "command");
      cwd = string(input.cwd) ?? string(input.cwd_path);
      agentLabel = "Claude Code";
      break;
    case "cursor":
      command = string(input.command) ?? nestedString(input.tool_input, "command");
      cwd = string(input.cwd);
      agentLabel = "Cursor";
      break;
    case "gemini":
      command = nestedString(input.tool_input, "command") ?? string(input.command);
      cwd = string(input.cwd);
      agentLabel = "Gemini CLI";
      break;
  }

  if (!command) throw new Error("O hook não contém um comando de shell reconhecido.");
  return { command, cwd: cwd ?? process.cwd(), agentLabel };
}

/** Encodes the common Shall decision in the host agent's native hook format. */
export function formatHookDecision(
  adapter: HookAdapter,
  allowed: boolean,
  reason: string,
): JsonObject {
  switch (adapter) {
    case "codex":
    case "claude":
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: allowed ? "allow" : "deny",
          ...(allowed ? {} : { permissionDecisionReason: reason }),
        },
      };
    case "cursor":
      return {
        permission: allowed ? "allow" : "deny",
        ...(allowed ? {} : { user_message: reason, agent_message: reason }),
      };
    case "gemini":
      return allowed ? { decision: "allow" } : { decision: "deny", reason };
    case "shall":
      return { decision: allowed ? "allow" : "deny", reason: allowed ? undefined : reason };
  }
}
