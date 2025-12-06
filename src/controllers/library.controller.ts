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
        const result = await libraryService.browseLibrary({
          stream: query.stream,
          subject: query.subject,
          grade: query.grade,
          medium: query.medium,
          resourceType: query.resourceType,
          page: query.page ? Number(query.page) : 1,
          limit: query.limit ? Number(query.limit) : 20,
        });

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
      query: t.Object({
        stream: t.Optional(t.String()),
        subject: t.Optional(t.String()),
        grade: t.Optional(t.String()),
        medium: t.Optional(t.String()),
        resourceType: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        summary: "Browse Library with Filters",
        description:
          "Browse library resources with tag-based filters (AND logic). Returns hierarchical structure with pagination.",
        tags: ["Library"],
        parameters: [
          {
            name: "stream",
            in: "query",
            description:
              "Filter by Stream (e.g., 'A/L Subjects', 'O/L Subjects')",
            schema: { type: "string" },
          },
          {
            name: "subject",
            in: "query",
            description: "Filter by Subject (e.g., 'Economics', 'Biology')",
            schema: { type: "string" },
          },
          {
            name: "grade",
            in: "query",
            description: "Filter by Grade (e.g., 'Grade 12', 'Grade 13')",
            schema: { type: "string" },
          },
          {
            name: "medium",
            in: "query",
            description:
              "Filter by Medium (e.g., 'English Medium', 'Sinhala Medium')",
            schema: { type: "string" },
          },
          {
            name: "resourceType",
            in: "query",
            description: "Filter by Resource Type (e.g., 'Unit', 'Syllabus')",
            schema: { type: "string" },
          },
          {
            name: "page",
            in: "query",
            description: "Page number (default: 1)",
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            description: "Results per page (default: 20)",
            schema: { type: "string" },
          },
        ],
      },
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
