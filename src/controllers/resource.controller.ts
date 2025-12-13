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
        tagName: query.tagName,
        tagNames: query.tagNames,
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
        tagName: t.Optional(t.String()), 
        tagNames: t.Optional(t.String({ description: "Comma-separated tag names for AND logic" })), 
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
            tags: legacyTags,
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

        log.info("Starting user resource upload (Store Strategy)", {
          userId: user.userId,
          fileName: file.name
        });

        // Collect all tags via Helper
        const tagPromises: Promise<any>[] = [];
        if (level) tagPromises.push(tagService.getOrCreateTag(level, "LEVEL"));
        if (stream) tagPromises.push(tagService.getOrCreateTag(stream, "STREAM"));
        if (subject) tagPromises.push(tagService.getOrCreateTag(subject, "SUBJECT"));
        if (grade) tagPromises.push(tagService.getOrCreateTag(grade, "GRADE"));
        if (medium) tagPromises.push(tagService.getOrCreateTag(medium, "MEDIUM"));
        if (resourceType) tagPromises.push(tagService.getOrCreateTag(resourceType, "RESOURCE_TYPE"));
        if (lesson) tagPromises.push(tagService.getOrCreateTag(lesson, "LESSON"));
        
        if (legacyTags) {
             legacyTags.split(",").map(t => t.trim()).filter(Boolean).forEach(t => 
                 tagPromises.push(tagService.getOrCreateTag(t))
             );
        }

        const resolvedTags = await Promise.all(tagPromises);
        
        if (resolvedTags.length === 0) {
           set.status = 400;
           return errorResponse("At least one tag is required", 400);
        }

        // 1. Ensure STORE Folder (User Uploads -> Bucket)
        const storeFolderId = await driveService.ensureStoreFolder();

        // 2. Upload
        const { Readable } = await import("stream");
        // @ts-ignore
        const streamData = Readable.from(file.stream());
        const driveFile = await driveService.uploadFile(streamData, file.name, storeFolderId, file.type);

        // 3. Create Resource
        const tagIds = resolvedTags.map((tag) => tag.id);
        const userSourceTag = await tagService.getOrCreateTag("USER");
        tagIds.push(userSourceTag.id);

        const resource = await resourceService.createResource({
          title: title || file.name,
          description: description || "",
          driveFileId: driveFile.id,
          mimeType: file.type || "application/octet-stream",
          fileSize: BigInt(file.size),
          status: "APPROVED", // Default Approved as requested
          source: "USER",
          uploaderId: user.userId,
          tagIds,
          storageNodeId: 1, 
        });

        return successResponse(resource, "Resource uploaded successfully (Store Bucket).");
      } catch (error) {
        log.error("User upload error", error as Error);
        set.status = 500;
        return errorResponse(error instanceof AppError ? error.message : "Upload failed", 500);
      }
    },
    {
      body: t.Object({
        file: t.File(),
        tags: t.Optional(t.String()),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        level: t.Optional(t.String()),
        stream: t.Optional(t.String()),
        subject: t.Optional(t.String()),
        grade: t.Optional(t.String()),
        medium: t.Optional(t.String()),
        resourceType: t.Optional(t.String()),
        lesson: t.Optional(t.String())
      }),
      detail: { tags: ["Resource"] }
    }
  )
  .get(
    "/:id/stream",
    async ({ params, headers, set }) => {
      try {
        const resource = await resourceService.getResourceById(params.id);
        if (!resource || !resource.driveFileId) {
            set.status = 404; return errorResponse("Resource not found", 404);
        }
        
        const { stream, contentType, contentLength } = await driveService.getStream(resource.driveFileId, headers["range"]);

        resourceService.incrementDownloadCount(params.id).catch(() => {});
        set.headers["Content-Type"] = contentType;
        if (contentLength) set.headers["Content-Length"] = String(contentLength);
        if (headers["range"]) { set.status = 206; set.headers["Accept-Ranges"] = "bytes"; }

        return stream;
      } catch (error) {
        log.error("Stream error", error as Error);
        set.status = 500;
        return errorResponse("Streaming failed", 500);
      }
    },
    { detail: { tags: ["Resource"] } }
  )
  .post(
    "/admin/upload",
    async ({ body, user, set }) => {
      if (!user || user.role !== Role.ADMIN) {
        set.status = 403;
        return errorResponse("Admins only", 403);
      }

      try {
        const { 
            file, title, description,
            level, stream, subject, grade, medium, resourceType, lesson
        } = body;

        if (!file) { set.status = 400; return errorResponse("File required", 400); }

        // 1. Resolve Hierarchy Tags (for Folder Building)
        // We need the ACTUAL NAMES for folder building, and IDs for DB.
        // tagService.getOrCreateTag returns { id, name, group... }
        
        const hierarchyMap: any = {};
        const allTags = [];
        let currentParentId: string | null = null;

        // 1. Level (A/L)
        if (level) { 
            const t = await tagService.getOrCreateTag(level, "LEVEL", currentParentId); 
            hierarchyMap.level = t; allTags.push(t); 
            currentParentId = t.id;
        }

        // 2. Grade (12) - NOW Second
        if (grade) { 
            const t = await tagService.getOrCreateTag(grade, "GRADE", currentParentId); 
            hierarchyMap.grade = t; allTags.push(t); 
            currentParentId = t.id;
        }

        // 3. Stream (Science) - NOW Third (Optional)
        if (stream) { 
            const t = await tagService.getOrCreateTag(stream, "STREAM", currentParentId); 
            hierarchyMap.stream = t; allTags.push(t); 
            currentParentId = t.id;
        }

        // 4. Subject (Physics)
        if (subject) { 
            const t = await tagService.getOrCreateTag(subject, "SUBJECT", currentParentId); 
            hierarchyMap.subject = t; allTags.push(t); 
            currentParentId = t.id;
        }
        
        // 5. Lesson (Unit 1)
        if (lesson) { 
            const t = await tagService.getOrCreateTag(lesson, "LESSON", currentParentId); 
            hierarchyMap.lesson = t; allTags.push(t); 
            currentParentId = t.id;
        }
        
        // Attributes (don't affect folder structure, but added to DB)
        if (medium) allTags.push(await tagService.getOrCreateTag(medium, "MEDIUM"));
        if (resourceType) allTags.push(await tagService.getOrCreateTag(resourceType, "RESOURCE_TYPE"));

        // 2. Build Canonical Folder
        const targetFolderId = await driveService.ensureCanonicalFolder(hierarchyMap);

        // 3. Upload
        const { Readable } = await import("stream");
        // @ts-ignore
        const streamData = Readable.from(file.stream());
        const driveFile = await driveService.uploadFile(streamData, file.name, targetFolderId, file.type);

        // 4. Create Resource
        const adminTag = await tagService.getOrCreateTag("ADMIN");
        const tagIds = allTags.map(t => t.id).concat(adminTag.id);

        const resource = await resourceService.createResource({
          title: title || file.name,
          description: description || "Admin Upload",
          driveFileId: driveFile.id,
          mimeType: file.type || "application/octet-stream",
          fileSize: BigInt(file.size),
          status: "APPROVED",
          source: "SYSTEM",
          uploaderId: user.userId,
          tagIds,
          storageNodeId: 1
        });

        return successResponse(resource, "Admin Resource Uploaded (Canonical Hierarchy)");

      } catch (error) {
        log.error("Admin upload error", error as Error);
        set.status = 500;
        return errorResponse(error instanceof AppError ? error.message : "Upload failed", 500);
      }
    },
    {
      body: t.Object({
        file: t.File(),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        // Hierarchy Params
        level: t.Optional(t.String()),
        stream: t.Optional(t.String()),
        subject: t.Optional(t.String()),
        grade: t.Optional(t.String()),
        lesson: t.Optional(t.String()),
        // Attribute Params
        medium: t.Optional(t.String()),
        resourceType: t.Optional(t.String())
      }),
      detail: { tags: ["Resource"] }
    }
  );
