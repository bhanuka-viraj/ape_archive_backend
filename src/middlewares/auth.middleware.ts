import { Elysia } from "elysia";
import { jwtPlugin } from "../plugins/jwt";
import { UnauthorizedError, ForbiddenError } from "../utils/error";
import { log } from "../utils/logger";

export const authMiddleware = (app: Elysia) =>
  app.use(jwtPlugin).derive(async ({ jwt, headers }) => {
    const authHeader = headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return { user: null };
    }

    const token = authHeader.split(" ")[1];
    const payload = await jwt.verify(token);

    if (!payload) {
      log.warn("Invalid JWT token provided");
      return { user: null };
    }

    return {
      user: {
        id: payload.id as string,
        userId: payload.id as string, // For backward compatibility
        role: payload.role as string,
        type: payload.type as string,
        ...payload,
      },
    };
  });

export const isAuthenticated = (app: Elysia) =>
  app.use(authMiddleware).onBeforeHandle(({ user, request }) => {
    if (!user) {
      log.warn("Unauthorized access attempt", {
        url: request.url,
        method: request.method,
      });
      throw new UnauthorizedError("Unauthorized");
    }
  });

export const authorize = (allowedRoles: string[]) => (app: Elysia) =>
  app.use(authMiddleware).onBeforeHandle(({ user, request }) => {
    if (!user) {
      log.warn("Unauthorized access attempt", {
        url: request.url,
        method: request.method,
      });
      throw new UnauthorizedError("Unauthorized");
    }
    if (!allowedRoles.includes(user.role)) {
      log.warn("Forbidden access attempt", {
        userId: user.id,
        role: user.role,
        requiredRoles: allowedRoles,
        url: request.url,
      });
      throw new ForbiddenError(
        `Insufficient permissions. Required: ${allowedRoles.join(", ")}`
      );
    }
  });
