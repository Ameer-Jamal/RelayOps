import path from "node:path";

// Resolve local configuration from the repository, regardless of the MCP client cwd.
process.chdir(path.resolve(__dirname, "../.."));

import { APP_VERSION } from "../core/version";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RelayOpsApplication } from "../core/application";
import type { RuleTrigger } from "../types";

async function main() {
  // Direct all application logs to stderr so stdio remains clean for MCP JSON-RPC
  const app = new RelayOpsApplication({ loggerOutput: "stderr" });
  // MCP tools run on demand; never start polling rules or the HTTP listener here.
  app.config.alerts.soundEnabled = false;

  const server = new McpServer(
    {
      name: "relayops",
      version: APP_VERSION
    },
    {
      instructions:
        "RelayOps MCP server enables AI assistants to send Microsoft Teams messages, list conversations, run automation triggers, and inspect status without requiring Teams admin privileges."
    }
  );

  // 1. Send Teams Message
  server.tool(
    "teams_send_message",
    "Send a message or notification to a Microsoft Teams chat or channel.",
    {
      target: z
        .string()
        .describe(
          "An exact discovered Teams name or team/channel name, an optional configured alias, a Teams URL, or a conversation ID. Use teams_search_destinations first for unfamiliar recipients."
        ),
      message: z.string().min(1).describe("Plain message text to send")
    },
    async ({ target, message }) => {
      try {
        await app.teamsSend(target, message);
        return {
          content: [
            {
              type: "text",
              text: `Message successfully posted to "${target}".`
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to send Teams message to "${target}": ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // 2. List Configured Targets
  server.tool(
    "teams_list_targets",
    "List all named target chats and channels configured in RelayOps rules.",
    {},
    async () => {
      const targets = app.getRulesConfigView().targets;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(targets, null, 2)
          }
        ]
      };
    }
  );

  // 3. List Active Teams Conversations
  server.tool(
    "teams_list_conversations",
    "Fetch active Microsoft Teams conversations (chats and channels) via the Teams Chat Service.",
    {
      pageSize: z
        .number().int().min(1).max(100)
        .optional()
        .describe("Number of recent conversations to fetch (default: 30)")
    },
    async ({ pageSize }) => {
      try {
        const conversations = await app.listTeamsConversations(pageSize ?? 30);
        if (conversations.length === 0) {
          const hasToken = app.getTeamsAdapter().chatService.hasValidToken();
          return {
            isError: !hasToken,
            content: [
              {
                type: "text",
                text: hasToken
                  ? "No active conversations found."
                  : "Teams session token is not yet captured. Use 'relayops_authenticate_teams' or send a message to trigger session capture."
              }
            ]
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(conversations, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to list conversations: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  server.tool(
    "teams_search_destinations",
    "Search the account-specific Teams directory by person name/email, chat, team/channel, or ID. Refresh discovers accessible destinations without sending messages. Resolve duplicate names before sending; use returned IDs for exact delivery.",
    {
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      kind: z.enum(["all", "person", "chat", "channel"]).optional(),
      refresh: z.boolean().optional().describe("Force a read-only API scan; otherwise refresh only when the cache is stale (15 minutes)")
    },
    async ({ query, limit, offset, kind, refresh }) => {
      const cached = await app.getTeamsDirectory({ query, limit, offset, kind });
      const directory = refresh || cached.stale ? await app.getTeamsDirectory({ query, limit, offset, kind, refresh: true }) : cached;
      return {
        isError: directory.api.state !== "ready",
        content: [{ type: "text", text: JSON.stringify(directory, null, 2) }]
      };
    }
  );

  // 4. Read Messages
  server.tool(
    "teams_read_messages",
    "Read recent messages from a Microsoft Teams chat or channel.",
    {
      target: z
        .string()
        .describe(
          "Target name from rules.local.yaml (e.g. 'Myself', 'review_channel'), a URL, or a conversation ID"
        ),
      limit: z
        .number().int().min(1).max(100)
        .optional()
        .describe("Max number of recent messages to return (default: 10)")
    },
    async ({ target, limit }) => {
      try {
        const messages = await app.teamsRead(target, limit ?? 10);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(messages, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to read messages from "${target}": ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // 5. System Status
  server.tool(
    "relayops_get_status",
    "Get RelayOps system status, token state, active alerts, and recent rule executions.",
    {},
    async () => {
      const dashboard = await app.getDashboardStatus();
      const chatService = app.getTeamsAdapter().chatService;
      const token = chatService.getToken();

      const status = {
        ...dashboard,
        teamsToken: {
          available: chatService.hasValidToken(),
          region: token?.region ?? null,
          hasBearerToken: Boolean(token?.bearerToken),
          updatedAt: token?.updatedAt ?? null,
          authenticationMode: token?.chatServiceToken ? "bearer" : token?.skypeToken ? "skypetoken" : null,
          accountEmail: token?.accountEmail ?? null,
          apiEndpoint: token?.apiBaseUrl ?? null
        }
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2)
          }
        ]
      };
    }
  );

  // 6. Run Automation Trigger
  server.tool(
    "relayops_run_trigger",
    "Manually execute a RelayOps trigger pipeline (e.g. check Bitbucket PRs and notify Teams).",
    {
      trigger: z
        .enum(["new_pr", "unread_message", "manual"])
        .describe("Trigger type to run"),
      ignoreGuards: z
        .boolean()
        .optional()
        .describe("Bypass cooldowns, deduplication, and execution guards (default: false)")
    },
    async ({ trigger, ignoreGuards }) => {
      try {
        const result = await app.runTrigger(trigger as RuleTrigger, {
          ignoreGuards: ignoreGuards ?? false
        });
        return {
          isError: result.rulesFailed > 0,
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to run trigger "${trigger}": ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // 7. Authenticate Teams Session
  server.tool(
    "relayops_authenticate_teams",
    "Launch or validate the Teams browser session to capture authentication tokens.",
    {
      waitForLogin: z
        .boolean()
        .optional()
        .describe("Whether to wait for user to sign in if currently logged out (default: true)")
    },
    async ({ waitForLogin }) => {
      try {
        await app.validateTeamsSession(waitForLogin ?? true);
        const hasToken = app.getTeamsAdapter().chatService.hasValidToken();
        return {
          isError: !hasToken,
          content: [
            {
              type: "text",
              text: hasToken
                ? "Teams session validated and API token successfully captured!"
                : "Teams browser session validated, but no supported Chat Service token was captured. Open a chat and authenticate again."
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Teams validation error: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await app.stop();
  };
  server.server.onclose = () => { void shutdown(); };
  process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("RelayOps MCP server running on stdio\n");
}

main().catch((error) => {
  process.stderr.write(`Fatal MCP server error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
