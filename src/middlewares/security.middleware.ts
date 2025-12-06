import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "../config/env";

export const securityMiddleware = (app: Elysia) =>
  app
    .use(
      cors({
        origin: env.FRONTEND_WHITELIST,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
      })
    )
    .onRequest(({ set }) => {
      // Helmet-like headers
      set.headers["X-Content-Type-Options"] = "nosniff";
      set.headers["X-Frame-Options"] = "DENY";
      set.headers["X-XSS-Protection"] = "1; mode=block";
      set.headers["Referrer-Policy"] = "no-referrer";
      set.headers["Strict-Transport-Security"] =
        "max-age=15552000; includeSubDomains";
      set.headers["X-Download-Options"] = "noopen";
      set.headers["X-Permitted-Cross-Domain-Policies"] = "none";
    });
