import fs from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import type { ApiFailure, ApiSuccess } from "../shared/adminApi";
import type { RelayOpsApplication } from "../core/application";
import type { RuleConfig } from "../types";
import type { SetupConfigUpdateInput, TargetRecord } from "../shared/adminApi";

function sendSuccess<T>(response: Response, data: T, status = 200): void {
  const payload: ApiSuccess<T> = {
    ok: true,
    data
  };
  response.status(status).json(payload);
}

function sendFailure(response: Response, message: string, status = 500, details?: unknown): void {
  const payload: ApiFailure = {
    ok: false,
    error: {
      message,
      ...(details ? { details } : {})
    }
  };
  response.status(status).json(payload);
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

export class RelayOpsServer {
  private appServer?: Express;
  private httpServer?: Server;

  constructor(private readonly app: RelayOpsApplication) {}

  async start(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    this.appServer = express();
    this.appServer.use(express.json());
    this.registerRoutes(this.appServer);

    await new Promise<void>((resolve, reject) => {
      this.httpServer = this.appServer?.listen(
        this.app.config.server.port,
        this.app.config.server.host,
        () => resolve()
      );
      this.httpServer?.once("error", reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    this.httpServer = undefined;
    this.appServer = undefined;
  }

  private registerRoutes(server: Express): void {
    server.get("/health", (_request, response) => {
      response.json({
        ok: true,
        app: this.app.config.appName
      });
    });

    server.get("/api/health", asyncHandler(async (_request, response) => {
      sendSuccess(response, await this.app.getDashboardStatus());
    }));

    server.get("/api/status", asyncHandler(async (_request, response) => {
      sendSuccess(response, await this.app.getDashboardStatus());
    }));

    server.get("/api/config", (_request, response) => {
      sendSuccess(response, this.app.getSetupConfig());
    });

    server.put("/api/config", (request, response) => {
      const payload = request.body as SetupConfigUpdateInput;
      sendSuccess(response, this.app.saveSetupConfig(payload));
    });

    server.post("/api/validate/config", (_request, response) => {
      sendSuccess(response, this.app.validateConfig());
    });

    server.get("/api/targets", (_request, response) => {
      sendSuccess(response, this.app.getRulesConfigView().targets);
    });

    server.put("/api/targets", (request, response) => {
      const payload = request.body as { targets: TargetRecord[] };
      sendSuccess(response, this.app.saveTargets(payload.targets));
    });

    server.get("/api/rules", (_request, response) => {
      const config = this.app.getRulesConfigView();
      sendSuccess(response, {
        filePath: config.filePath,
        rawYaml: config.rawYaml,
        rules: config.rules,
        usingExampleSource: config.usingExampleSource
      });
    });

    server.put("/api/rules", (request, response) => {
      const payload = request.body as { rules: RuleConfig[] };
      sendSuccess(response, this.app.saveRules(payload.rules));
    });

    server.get("/api/rules-config", (_request, response) => {
      sendSuccess(response, this.app.getRulesConfigView());
    });

    server.get("/api/alerts", (request, response) => {
      const limit = Number.parseInt(String(request.query.limit ?? "200"), 10);
      sendSuccess(response, this.app.getAlerts(limit));
    });

    server.post("/api/alerts/clear", asyncHandler(async (_request, response) => {
      sendSuccess(response, {
        cleared: await this.app.clearAlerts()
      });
    }));

    server.post("/api/alerts/ack-all", (request, response) => {
      sendSuccess(response, {
        acknowledged: this.app.acknowledgeAllAlerts(
          typeof request.body?.acknowledgedBy === "string" ? request.body.acknowledgedBy : undefined
        )
      });
    });

    server.post("/api/alerts/:dedupeKey/ack", (request, response) => {
      sendSuccess(response, {
        acknowledged: this.app.acknowledgeAlert(
          request.params.dedupeKey,
          typeof request.body?.acknowledgedBy === "string" ? request.body.acknowledgedBy : undefined
        )
      });
    });

    server.get("/api/logs", (request, response) => {
      const limit = Number.parseInt(String(request.query.limit ?? "200"), 10);
      sendSuccess(response, this.app.getLogs(limit));
    });

    server.get("/api/executions", (request, response) => {
      const limit = Number.parseInt(String(request.query.limit ?? "200"), 10);
      sendSuccess(response, this.app.getRuleExecutions(limit));
    });

    server.get("/api/state", (request, response) => {
      const limit = Number.parseInt(String(request.query.limit ?? "200"), 10);
      sendSuccess(response, this.app.snapshotState(limit));
    });

    server.post("/api/actions/run-trigger", asyncHandler(async (request, response) => {
      sendSuccess(
        response,
        await this.app.runTrigger(request.body.trigger, {
          ignoreGuards: Boolean(request.body?.ignoreGuards)
        })
      );
    }));

    server.post("/api/actions/teams/open", asyncHandler(async (_request, response) => {
      await this.app.openTeamsSession();
      sendSuccess(response, {
        message: "Teams session opened in the persistent browser profile."
      });
    }));

    server.post("/api/actions/teams/test-post", asyncHandler(async (request, response) => {
      await this.app.teamsSend(request.body.target, request.body.text);
      sendSuccess(response, {
        message: "Teams test post sent."
      });
    }));

    server.post("/api/actions/teams/validate", asyncHandler(async (request, response) => {
      await this.app.validateTeamsSession(Boolean(request.body?.waitForLogin));
      sendSuccess(response, {
        message: "Teams session validated."
      });
    }));

    server.use("/api", (error: Error, _request: Request, response: Response, _next: unknown) => {
      sendFailure(response, error.message, 500);
    });

    this.registerStaticUi(server);

    server.use((error: Error, _request: Request, response: Response, _next: unknown) => {
      sendFailure(response, error.message, 500);
    });
  }

  private registerStaticUi(server: Express): void {
    const webDistPath = path.join(process.cwd(), "web", "dist");
    if (!fs.existsSync(webDistPath)) {
      server.get("/", (_request, response) => {
        response.type("text/plain").send(
          "RelayOps backend is running. Build the local admin GUI with `npm run ui:build` or run it in dev mode with `npm run ui:dev`."
        );
      });
      return;
    }

    server.use(express.static(webDistPath));
    server.get("*", (request, response, next) => {
      if (request.path.startsWith("/api")) {
        next();
        return;
      }

      response.sendFile(path.join(webDistPath, "index.html"));
    });
  }
}
