import { Elysia, t } from "elysia";
import { tagService } from "../services/tag.service";
import { successResponse, errorResponse } from "../utils/response";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";
import { TagSource } from "@prisma/client";

export const tagController = new Elysia()
  /**
   * Get all tags with optional grouping
   */
  .get(
    "/",
    async ({ query }) => {
      const tags = await tagService.getTags({
        source: query.source as TagSource,
        group: query.group,
      });
      return successResponse(tags, "Tags fetched successfully");
    },
    {
      query: t.Object({
        source: t.Optional(t.Enum(TagSource)),
        group: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Tag"],
      },
    }
  )
  /**
   * Get tags grouped by their group field
   */
  .get(
    "/grouped",
    async ({ query }) => {
      const grouped = await tagService.getTagsGrouped(
        query.source as TagSource
      );
      return successResponse(grouped, "Tags grouped successfully");
    },
    {
      detail: {
        tags: ["Tag"],
      },
    }
  )
  /**
   * Get single tag by ID
   */
  .get(
    "/:id",
    async ({ params, set }) => {
      const tag = await tagService.getTagById(params.id);
      if (!tag) {
        set.status = 404;
        return errorResponse("Tag not found", 404);
      }
      return successResponse(tag, "Tag fetched successfully");
    },
    {
      detail: {
        tags: ["Tag"],
      },
    }
  )
  /**
   * Create new tag (User-created)
   */
  .post(
    "/",
    async ({ body, set }) => {
      if (!body.name) {
        set.status = 400;
        return errorResponse("Tag name is required", 400);
      }

      log.info("Creating new tag", { name: body.name });

      const tag = await tagService.getOrCreateTag(body.name, body.group);

      set.status = 201;
      return successResponse(tag, "Tag created successfully");
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        group: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Tag"],
      },
    }
  )
  /**
   * Update tag
   */
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        log.info("Updating tag", { id: params.id });

        const tag = await tagService.updateTag(params.id, body);

        set.status = 200;
        return successResponse(tag, "Tag updated successfully");
      } catch (error) {
        set.status = 400;
        return errorResponse((error as Error).message, 400);
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        group: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Tag"],
      },
    }
  )
  /**
   * Delete tag
   */
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        log.info("Deleting tag", { id: params.id });

        await tagService.deleteTag(params.id);

        set.status = 200;
        return successResponse(null, "Tag deleted successfully");
      } catch (error) {
        set.status = 400;
        return errorResponse((error as Error).message, 400);
      }
    },
    {
      detail: {
        tags: ["Tag"],
      },
    }
  );
