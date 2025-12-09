import { Elysia, t } from "elysia";
import { resourceService } from "../services/resource.service";
import { driveService } from "../services/drive.service";
import { tagService } from "../services/tag.service";
import { libraryService } from "../services/library.service";
import { successResponse, errorResponse } from "../utils/response";
import { ResourceStatus, Role } from "@prisma/client";
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
        tagId: query.tagId,
        status: query.status as ResourceStatus,
      });
      return successResponse(resources, "Resources fetched successfully");
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        search: t.Optional(t.String()),
        tagId: t.Optional(t.String()),
        status: t.Optional(t.Enum(ResourceStatus)),
      }),
      detail: {
        tags: ["Resource"],
      },
    }
  )
  .get(
    "/:id",
    async ({ params, set }) => {
      const resource = await resourceService.getResourceById(params.id);
      if (!resource) {
        set.status = 404;
        return errorResponse("Resource not found", 404);
      }
      // Increment view count (non-blocking)
      resourceService.incrementViewCount(params.id).catch(() => {});
      return successResponse(resource, "Resource fetched successfully");
    },
    {
      detail: {
        tags: ["Resource"],
      },
    }
  )
  .post(
    "/upload",
    async ({ body, user, set }) => {
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const { 
            file, 
            tags: legacyTags, // Keep for backward compatibility or extra tags
            title, 
            description,
            level,
            stream,
            subject,
            grade,
            medium,
            resourceType,
            lesson 
        } = body;

        if (!file) {
          set.status = 400;
          return errorResponse("File is required", 400);
        }

        log.info("Starting user resource upload", {
          userId: user.userId,
          fileName: file.name,
          hierarchy: { level, stream, subject, grade, medium, resourceType, lesson }
        });

        // Collect all tag promises
        const tagPromises: Promise<any>[] = [];

        // 1. Handle Explicit Hierarchy Fields
        if (level) tagPromises.push(tagService.getOrCreateTag(level, "LEVEL"));
        if (stream) tagPromises.push(tagService.getOrCreateTag(stream, "STREAM"));
        if (subject) tagPromises.push(tagService.getOrCreateTag(subject, "SUBJECT"));
        if (grade) tagPromises.push(tagService.getOrCreateTag(grade, "GRADE"));
        if (medium) tagPromises.push(tagService.getOrCreateTag(medium, "MEDIUM"));
        if (resourceType) tagPromises.push(tagService.getOrCreateTag(resourceType, "RESOURCE_TYPE"));
        if (lesson) tagPromises.push(tagService.getOrCreateTag(lesson, "LESSON"));

        // 2. Handle Legacy/Extra Tags (Comma Separated)
        if (legacyTags && legacyTags.trim() !== "") {
             const extraTags = legacyTags.split(",").map(t => t.trim()).filter(t => t.length > 0);
             extraTags.forEach(t => tagPromises.push(tagService.getOrCreateTag(t))); // No group by default
        }

        const resolvedTags = await Promise.all(tagPromises);
        
        if (resolvedTags.length === 0) {
           set.status = 400;
           return errorResponse("At least one tag or hierarchy field is required", 400);
        }

        // Upload file to UPLOAD_FOLDER_ID
        const { Readable } = await import("stream");
        // @ts-ignore
        const streamData = Readable.from(file.stream());

        const uploadFolderId = process.env.UPLOAD_FOLDER_ID;
        if (!uploadFolderId) {
          set.status = 500;
          return errorResponse("Upload folder not configured", 500);
        }

        const driveFile = await driveService.uploadFile(
          streamData,
          file.name,
          uploadFolderId,
          file.type
        );

        log.info("File uploaded to Drive", {
          driveFileId: driveFile.id,
          fileName: file.name,
        });

        // Create Resource in DB with USER source
        const tagIds = resolvedTags.map((tag) => tag.id);

        // Add USER tag for backend use
        const userSourceTag = await tagService.getOrCreateTag("USER");
        tagIds.push(userSourceTag.id);

        const resource = await resourceService.createResource({
          title: title || file.name,
          description: description || "",
          driveFileId: driveFile.id,
          mimeType: file.type || "application/octet-stream",
          fileSize: BigInt(file.size),
          status: "APPROVED", // Auto-approved for now
          source: "USER", // Mark as user-uploaded
          uploaderId: user.userId,
          tagIds,
          storageNodeId: 1, 
        });

        log.info("User resource created", {
          resourceId: resource.id,
          userId: user.userId,
          tags: resolvedTags.map(t => t.name),
        });

        set.status = 201;
        return successResponse(
          resource,
          "Resource uploaded successfully."
        );
      } catch (error) {
        log.error("User upload error", error as Error);
        set.status = 500;
        const message =
          error instanceof AppError ? error.message : "Upload failed";
        return errorResponse(message, 500);
      }
    },
    {
      body: t.Object({
        file: t.File(),
        tags: t.Optional(t.String({ description: "Comma-separated tag names (Legacy)" })),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        // New Hierarchy Fields
        level: t.Optional(t.String()),
        stream: t.Optional(t.String()),
        subject: t.Optional(t.String()),
        grade: t.Optional(t.String()),
        medium: t.Optional(t.String()),
        resourceType: t.Optional(t.String()),
        lesson: t.Optional(t.String())
      }),
      detail: {
        tags: ["Resource"],
        summary: "Upload Resource (User)",
        description:
          "Upload a resource with hierarchy tags. Creates new tags if not exist (e.g. new Lesson).",
      },
    }
  )
  .get(
    "/:id/stream",
    async ({ params, headers, set }) => {
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
    },
    {
      detail: {
        tags: ["Resource"],
      },
    }
  )
  // --- LIBRARY ENDPOINTS ---
  .get(
    "/library/hierarchy",
    async ({ set }) => {
      try {
        const hierarchy = await libraryService.getLibraryHierarchy();
        return successResponse(
          hierarchy,
          "Library hierarchy fetched successfully"
        );
      } catch (error) {
        log.error("Library fetch error", error as Error);
        set.status = 500;
        return errorResponse("Failed to fetch library", 500);
      }
    },
    {
      detail: {
        tags: ["Resource"],
      },
    }
  )
  .get(
    "/library/tags",
    async ({ set }) => {
      try {
        const tags = await libraryService.getAvailableTagsForUpload();
        return successResponse(tags, "Available tags fetched successfully");
      } catch (error) {
        log.error("Tags fetch error", error as Error);
        set.status = 500;
        return errorResponse("Failed to fetch tags", 500);
      }
    },
    {
      detail: {
        tags: ["Resource"],
      },
    }
  )
  // --- ADMIN UPLOAD ENDPOINT ---
  .post(
    "/admin/upload",
    async ({ body, user, set }) => {
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      // Check if user is ADMIN
      if (user.role !== Role.ADMIN) {
        set.status = 403;
        return errorResponse("Only admins can use this endpoint", 403);
      }

      try {
        const { file, tagIds, title, description } = body;

        if (!file) {
          set.status = 400;
          return errorResponse("File is required", 400);
        }

        if (!tagIds || tagIds.length === 0) {
          set.status = 400;
          return errorResponse("At least one tag is required", 400);
        }

        log.info("Admin resource upload", {
          userId: user.userId,
          fileName: file.name,
          tagCount: tagIds.length,
        });

        // Upload file to Drive
        const { Readable } = await import("stream");
        // @ts-ignore
        const stream = Readable.from(file.stream());

        const driveFile = await driveService.uploadFile(
          stream,
          file.name,
          process.env.UPLOAD_FOLDER_ID || "",
          file.type
        );

        // Create Resource in DB marked as SYSTEM
        // Add ADMIN tag for backend use (to distinguish from user uploads)
        const adminSourceTag = await tagService.getOrCreateTag("ADMIN");
        const allTagIds = [...tagIds, adminSourceTag.id];

        const resource = await resourceService.createResource({
          title: title || file.name,
          description: description || "Admin uploaded resource",
          driveFileId: driveFile.id,
          mimeType: file.type || "application/octet-stream",
          fileSize: BigInt(file.size),
          status: "APPROVED", // Auto-approve admin uploads
          source: "SYSTEM", // Mark as system resource
          uploaderId: user.userId,
          tagIds: allTagIds, // Connect provided tags + ADMIN tag
          storageNodeId: 1, // Use default storage
        });

        log.info("Admin resource created", { resourceId: resource.id });
        return successResponse(
          resource,
          "Resource uploaded successfully (marked as SYSTEM)"
        );
      } catch (error) {
        log.error("Admin upload error", error as Error);
        set.status = 500;
        const message =
          error instanceof AppError ? error.message : "Upload failed";
        return errorResponse(message, 500);
      }
    },
    {
      body: t.Object({
        file: t.File(),
        tagIds: t.Array(t.String()),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Resource"],
      },
    }
  );
