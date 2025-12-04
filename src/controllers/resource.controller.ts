import { Elysia, t } from "elysia";
import { resourceService } from "../services/resource.service";
import { driveService } from "../services/drive.service";
import { categoryService } from "../services/category.service";
import { successResponse, errorResponse } from "../utils/response";
import { ResourceStatus, CategoryType } from "@prisma/client";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";

export const resourceController = new Elysia()
  .get(
    "/",
    async ({ query }) => {
      const resources = await resourceService.getResources({
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 10,
        search: query.search,
        category: query.category,
        status: query.status as ResourceStatus,
      });
      return successResponse(resources, "Resources fetched successfully");
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        search: t.Optional(t.String()),
        category: t.Optional(t.String()),
        status: t.Optional(t.Enum(ResourceStatus)),
      }),
    }
  )
  .get("/:id", async ({ params, set }) => {
    const resource = await resourceService.getResourceById(params.id);
    if (!resource) {
      set.status = 404;
      return errorResponse("Resource not found", 404);
    }
    // Increment view count (non-blocking)
    resourceService.incrementViewCount(params.id).catch(() => {});
    return successResponse(resource, "Resource fetched successfully");
  })
  .post(
    "/upload",
    async ({ body, user, set }) => {
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const { file, grade, subject, lesson, medium, title, description } =
          body;

        if (!file) {
          set.status = 400;
          return errorResponse("File is required", 400);
        }

        if (!grade || !subject || !lesson || !medium) {
          set.status = 400;
          return errorResponse(
            "All hierarchy fields (grade, subject, lesson, medium) are required",
            400
          );
        }

        log.info("Starting resource upload", {
          userId: user.userId,
          fileName: file.name,
          grade,
          subject,
          lesson,
          medium,
        });

        // 1. Ensure folder hierarchy exists in Drive
        const folderPath = [grade, subject, lesson, medium];
        const parentFolderId = await driveService.ensureFolderHierarchy(
          folderPath
        );

        // 2. Upload file to Drive (stream-based)
        const fileData = await file.arrayBuffer();
        const stream = require("stream").Readable.from(fileData);

        const driveFile = await driveService.uploadFile(
          stream,
          file.name,
          parentFolderId,
          file.type
        );

        // 3. Get or create categories
        const gradeCategory = await categoryService.getOrCreateCategory(
          grade,
          CategoryType.GRADE
        );
        const subjectCategory = await categoryService.getOrCreateCategory(
          subject,
          CategoryType.SUBJECT
        );
        const lessonCategory = await categoryService.getOrCreateCategory(
          lesson,
          CategoryType.LESSON
        );
        const mediumCategory = await categoryService.getOrCreateCategory(
          medium,
          CategoryType.MEDIUM
        );

        // 4. Create Resource record in DB
        const resource = await resourceService.createResource({
          title: title || file.name,
          description: description,
          driveFileId: driveFile.id,
          mimeType: file.type,
          fileSize: BigInt(fileData.byteLength),
          uploaderId: user.userId,
          categories: [
            gradeCategory.slug,
            subjectCategory.slug,
            lessonCategory.slug,
            mediumCategory.slug,
          ],
          status: ResourceStatus.PENDING, // Requires approval
        });

        set.status = 201;
        return successResponse(resource, "Resource uploaded successfully");
      } catch (error) {
        log.error("Upload error", error as Error);
        set.status = 500;
        const message =
          error instanceof AppError ? error.message : "Upload failed";
        return errorResponse(message, 500);
      }
    },
    {
      body: t.Object({
        file: t.File(),
        grade: t.String(),
        subject: t.String(),
        lesson: t.String(),
        medium: t.String(),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
      }),
    }
  )
  .get("/:id/stream", async ({ params, headers, set }) => {
    try {
      const resource = await resourceService.getResourceById(params.id);

      if (!resource) {
        set.status = 404;
        return errorResponse("Resource not found", 404);
      }

      if (!resource.driveFileId) {
        set.status = 400;
        return errorResponse("Resource does not have a file associated", 400);
      }

      log.info("Streaming resource", {
        resourceId: params.id,
        driveFileId: resource.driveFileId,
      });

      // Get stream from Drive service
      const { stream, contentType, contentLength } =
        await driveService.getStream(resource.driveFileId, headers["range"]);

      // Increment download count (non-blocking)
      resourceService.incrementDownloadCount(params.id).catch(() => {});

      // Set response headers
      set.headers["Content-Type"] = contentType;
      if (contentLength) {
        set.headers["Content-Length"] = contentLength;
      }

      // Handle Range requests
      if (headers["range"]) {
        set.status = 206; // Partial Content
        set.headers["Accept-Ranges"] = "bytes";
      }

      return stream;
    } catch (error) {
      log.error("Stream error", error as Error);
      set.status = 500;
      const message =
        error instanceof AppError ? error.message : "Failed to stream file";
      return errorResponse(message, 500);
    }
  });
