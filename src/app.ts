import { Elysia } from "elysia";
import { swaggerPlugin } from "./plugins/swagger";
import { securityMiddleware } from "./middlewares/security.middleware";
import { httpLoggerPlugin } from "./plugins/http-logger.plugin";
import { authRoutes } from "./routes/auth.routes";
import { healthRoutes } from "./routes/health.routes";
import { tagRoutes } from "./routes/tag.routes";
import { resourceRoutes } from "./routes/resource.routes";
import { libraryRoutes } from "./routes/library.routes";
import { announcementRoutes } from "./routes/announcement.routes";
import { forumRoutes } from "./routes/forum.routes";
import { teacherRoutes } from "./routes/teacher.routes";
import { errorResponse } from "./utils/response";
import { AppError, ValidationError } from "./utils/error";
import { parseDatabaseError } from "./utils/db-error-handler";

export const app = new Elysia()
  .use(httpLoggerPlugin)
  .use(securityMiddleware)
  .use(swaggerPlugin)
  .onError(({ code, error, set }) => {
    // Parse database errors first
    const parsedError = parseDatabaseError(error);

    if (code === "NOT_FOUND") {
      set.status = 404;
      return errorResponse("Route not found", 404);
    }

    if (parsedError instanceof ValidationError) {
      set.status = parsedError.statusCode;
      return errorResponse(
        parsedError.message,
        parsedError.statusCode,
        parsedError.details
      );
    }

    if (parsedError instanceof AppError) {
      set.status = parsedError.statusCode;
      return errorResponse(parsedError.message, parsedError.statusCode);
    }

    console.error("Global Error:", parsedError);
    set.status = 500;
    return errorResponse(
      "Internal Server Error",
      500,
      parsedError.message || "Unknown Error"
    );
  })
  .get("/", () => "Hello Elysia")
  .group("/api/v1", (app) =>
    app
      .use(healthRoutes)
      .use(authRoutes)
      .use(tagRoutes)
      .use(resourceRoutes)
      .use(libraryRoutes)
      .use(announcementRoutes)
      .use(forumRoutes)
      .use(teacherRoutes)
  );
