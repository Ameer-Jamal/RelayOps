import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../../types";

/**
 * Chromium shows a native "Open Microsoft Teams.app?" sheet on macOS when the page
 * invokes the msteams: protocol. Playwright cannot click that UI. Pre-seeding
 * allowed_origin_protocol_pairs reduces prompts; pairing with navigation off launcher.html
 * avoids many triggers in the first place.
 */
export function mergeTeamsProtocolHandlerPreferences(profileDir: string, logger: Logger): void {
  const defaultDir = path.join(profileDir, "Default");
  const prefsPath = path.join(defaultDir, "Preferences");

  try {
    fs.mkdirSync(defaultDir, { recursive: true });
  } catch (error) {
    logger.warn("Could not create Chromium Default profile directory", {
      profileDir,
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  let prefs: Record<string, unknown> = {};
  if (fs.existsSync(prefsPath)) {
    try {
      const raw = fs.readFileSync(prefsPath, "utf8");
      prefs = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      logger.warn("Could not read Chromium Preferences; skipping Teams protocol merge", {
        prefsPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }
  }

  const protocolHandler = (prefs.protocol_handler as Record<string, unknown> | undefined) ?? {};
  const pairs =
    (protocolHandler.allowed_origin_protocol_pairs as Record<string, Record<string, boolean>> | undefined) ?? {};

  const origins = ["https://teams.microsoft.com", "https://teams.microsoft.com,*", "https://teams.live.com"];
  const schemes = ["msteams", "MSTeams", "ms-teams"];

  let changed = false;
  for (const origin of origins) {
    const existing = pairs[origin] ?? {};
    const next = { ...existing };
    for (const scheme of schemes) {
      if (!next[scheme]) {
        next[scheme] = true;
        changed = true;
      }
    }
    pairs[origin] = next;
  }

  if (!changed && protocolHandler.allowed_origin_protocol_pairs) {
    return;
  }

  prefs.protocol_handler = {
    ...protocolHandler,
    allowed_origin_protocol_pairs: pairs
  };

  try {
    fs.writeFileSync(prefsPath, `${JSON.stringify(prefs)}\n`, "utf8");
    logger.debug("Merged Teams protocol-handler preferences into Chromium profile", { prefsPath });
  } catch (error) {
    logger.warn("Could not write Chromium Preferences for Teams protocol handling", {
      prefsPath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
