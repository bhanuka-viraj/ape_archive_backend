import { Elysia, t } from "elysia";
import { libraryService } from "../services/library.service";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../utils/error";
import { log } from "../utils/logger";

export const libraryController = new Elysia()
  .get(
    "/",
    async ({ set }) => {
      try {
        const hierarchy = await libraryService.getLibraryHierarchy();
        return successResponse(hierarchy, "Library hierarchy retrieved");
      } catch (error) {
        if (error instanceof AppError) {
          set.status = error.statusCode;
          return errorResponse(error.message, error.statusCode);
        }
        set.status = 500;
        return errorResponse("Failed to fetch library", 500);
      }
    },
    {
      detail: {
        summary: "Get Full Library Hierarchy",
        description:
          "Get the complete library folder structure with all SYSTEM resources organized by tags.",
        tags: ["Library"],
      },
    }
  )
  .get(
    "/browse",
    async ({ query, set }) => {
      try {
        // Pass the entire query object as filters
        // Pagination params (page, limit) are handled inside browse() if needed, or stripped.
        const result = await libraryService.browse(query as Record<string, string>);

        return successResponse(result, "Library browse results retrieved");
      } catch (error) {
        if (error instanceof AppError) {
          set.status = error.statusCode;
          return errorResponse(error.message, error.statusCode);
        }
        set.status = 500;
        return errorResponse("Failed to browse library", 500);
      }
    },
    {
       // validation: We verify specific params are strings if present, but allow extras?
       // Elysia doesn't support "Any query param" easily with strict schema.
       // Let's keep specific ones for documentation, but maybe add "additionalProperties"?
       // Actually, for now, let's just accept the explicit ones + generic 'query' access.
       query: t.Object({
        level: t.Optional(t.String()),
        stream: t.Optional(t.String()),
        subject: t.Optional(t.String()),
        grade: t.Optional(t.String()),
        medium: t.Optional(t.String()),
        resourceType: t.Optional(t.String()),
        lesson: t.Optional(t.String()),
        page: t.Optional(t.Numeric()), 
        limit: t.Optional(t.Numeric())
      }, { additionalProperties: true }), // Allow other params
      detail: {
        summary: "Browse Library (Drill-Down)",
        description: "Get 'Next Available Folders' and 'Resources' based on current tag filters.",
        tags: ["Library"],
      }
    }
  )

  .get(
    "/hierarchy",
    async ({ set }) => {
      try {
        const hierarchy = await libraryService.getLibraryHierarchy();
        return successResponse(
          hierarchy,
          "Complete library hierarchy retrieved"
        );
      } catch (error) {
        if (error instanceof AppError) {
          set.status = error.statusCode;
          return errorResponse(error.message, error.statusCode);
        }
        set.status = 500;
        return errorResponse("Failed to fetch library hierarchy", 500);
      }
    },
    {
      detail: {
        summary: "Get Full Library Hierarchy",
        description:
          "Get the complete library folder structure with all SYSTEM resources organized by tags.",
        tags: ["Library"],
      },
    }
  )
  .get(
    "/tags",
    async ({ set }) => {
      try {
        const tags = await libraryService.getAvailableTagsForUpload();
        return successResponse(tags, "Available library tags retrieved");
      } catch (error) {
        if (error instanceof AppError) {
          set.status = error.statusCode;
          return errorResponse(error.message, error.statusCode);
        }
        set.status = 500;
        return errorResponse("Failed to fetch tags", 500);
      }
    },
    {
      detail: {
        summary: "Get Available Library Tags",
        description:
          "Get all SYSTEM tags organized by group (Stream, Subject, Grade, Medium, ResourceType).",
        tags: ["Library"],
      },
    }
  );
