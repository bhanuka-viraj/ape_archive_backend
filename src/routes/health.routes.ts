import { Elysia } from "elysia";
import { log } from "../utils/logger";

export const healthRoutes = (app: Elysia) =>
  app.group("/health", (app) =>
    app.get(
      "/",
      () => {
        log.info("Health check requested");
        return {
          status: "ok",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        };
      },
      {
        detail: {
          tags: ["Health"],
        },
      }
    )
  );
