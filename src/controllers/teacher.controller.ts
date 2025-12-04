import { Elysia, t } from "elysia";
import { teacherService } from "../services/teacher.service";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../utils/error";
import { log } from "../utils/logger";

export const teacherController = new Elysia()
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const teachers = await teacherService.getTeachers(
          query.page ? Number(query.page) : 1,
          query.limit ? Number(query.limit) : 10,
          query.subject
        );
        return successResponse(teachers, "Teachers fetched successfully");
      } catch (error) {
        log.error("Error fetching teachers", error as Error);
        set.status = 500;
        const message =
          error instanceof AppError
            ? error.message
            : "Failed to fetch teachers";
        return errorResponse(message, 500);
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        subject: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id", async ({ params, set }) => {
    try {
      const teacher = await teacherService.getTeacherById(params.id);
      return successResponse(teacher, "Teacher fetched successfully");
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        set.status = 404;
        return errorResponse("Teacher not found", 404);
      }
      log.error("Error fetching teacher", error as Error);
      set.status = 500;
      return errorResponse("Failed to fetch teacher", 500);
    }
  })
  .get(
    "/subject/:slug",
    async ({ params, query, set }) => {
      try {
        const teachers = await teacherService.getTeachersBySubject(
          params.slug,
          query.page ? Number(query.page) : 1,
          query.limit ? Number(query.limit) : 10
        );
        return successResponse(
          teachers,
          `Teachers for subject '${params.slug}' fetched successfully`
        );
      } catch (error) {
        log.error("Error fetching teachers by subject", error as Error);
        set.status = 500;
        const message =
          error instanceof AppError
            ? error.message
            : "Failed to fetch teachers";
        return errorResponse(message, 500);
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  );
