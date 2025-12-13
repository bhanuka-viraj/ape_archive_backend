import { prisma } from "../config/database";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";
import { convertBigIntsToStrings } from "../utils/bigint-handler";
import { TagSource } from "@prisma/client";

interface GroupedTags {
  [groupName: string]: Array<{
    id: string;
    name: string;
    slug: string;
    source: TagSource;
  }>;
}

class TagService {
  /**
   * Get all tags with optional filtering
   */
  async getTags(filters?: {
    source?: TagSource;
    group?: string;
    search?: string;
  }): Promise<any[]> {
    try {
      const where: any = {};
      if (filters?.source) where.source = filters.source;
      if (filters?.group) where.group = filters.group;
      if (filters?.search) {
        where.name = {
           contains: filters.search.trim(),
           mode: 'insensitive'
        };
      }

      const tags = await prisma.tag.findMany({
        where,
        orderBy: [{ group: "asc" }, { name: "asc" }],
      });

      return tags;
    } catch (error) {
      log.error("Failed to get tags", error as Error);
      throw new AppError("Failed to fetch tags", 500);
    }
  }

  /**
   * Get tag by ID
   */
  async getTagById(id: string): Promise<any> {
    try {
      const tag = await prisma.tag.findUnique({
        where: { id },
        include: {
          resources: true,
        },
      });

      return convertBigIntsToStrings(tag);
    } catch (error) {
      log.error("Failed to get tag by ID", error as Error);
      throw new AppError("Failed to fetch tag", 500);
    }
  }

  /**
   * Get all tags grouped by their group field
   * Optionally filter by source (SYSTEM or USER)
   */
  async getTagsGrouped(source?: TagSource): Promise<GroupedTags> {
    try {
      const where: any = source ? { source } : {};
      // Exclude LESSON tags from grouped view (too many, use hierarchy instead)
      where.group = { not: "LESSON" };

      const tags = await prisma.tag.findMany({
        where,
        orderBy: [{ group: "asc" }, { name: "asc" }],
      });

      const grouped: GroupedTags = {};
      const seen = new Set<string>(); // composite key: "group:name"

      for (const tag of tags) {
        const groupName = tag.group || "Other";
        const compositeKey = `${groupName}:${tag.name.toLowerCase()}`; // Case insensitive dedup

        if (seen.has(compositeKey)) continue;
        seen.add(compositeKey);

        if (!grouped[groupName]) {
          grouped[groupName] = [];
        }
        grouped[groupName].push({
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          source: tag.source,
        });
      }

      return grouped;
    } catch (error) {
      log.error("Failed to get grouped tags", error as Error);
      throw new AppError("Failed to fetch tags", 500);
    }
  }

  /**
   * Get or create a tag (creates as USER source by default)
   */
  async getOrCreateTag(name: string, group?: string, parentId?: string | null): Promise<any> {
    try {
      const cleanName = name.trim();
      const slug = cleanName
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]/g, "");

      // Check if tag exists (Context Aware)
      const existing = await prisma.tag.findFirst({
        where: { 
            name: cleanName,
            parentId: parentId !== undefined ? parentId : undefined // Only filter by parent if provided
        },
      });

      if (existing) {
        return existing;
      }

      // Create new tag as USER source
      const tag = await prisma.tag.create({
        data: {
          name: cleanName,
          slug: slug,
          group: group || null,
          parentId: parentId || null,
          source: "USER", // User-created tags
        },
      });

      return tag;
    } catch (error) {
      log.error(`Failed to create tag "${name}"`, error as Error);
      throw new AppError("Failed to create tag", 500);
    }
  }

  /**
   * Update tag
   */
  async updateTag(
    id: string,
    data: { name?: string; group?: string }
  ): Promise<any> {
    try {
      // Verify tag exists
      const existing = await prisma.tag.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new AppError("Tag not found", 404);
      }

      // Generate new slug if name changed
      let updateData: any = { ...data };
      if (data.name) {
        const slug = data.name
          .toLowerCase()
          .trim()
          .replace(/\s+/g, "-")
          .replace(/[^\w-]/g, "");
        updateData.slug = slug;
      }

      const tag = await prisma.tag.update({
        where: { id },
        data: updateData,
      });

      return tag;
    } catch (error) {
      log.error("Failed to update tag", error as Error);
      throw error;
    }
  }

  /**
   * Delete tag
   */
  async deleteTag(id: string): Promise<void> {
    try {
      // Check if tag has resources
      const resources = await prisma.resource.count({
        where: {
          tags: {
            some: { id },
          },
        },
      });

      if (resources > 0) {
        throw new AppError(
          "Cannot delete tag with associated resources. Disassociate resources first.",
          400
        );
      }

      await prisma.tag.delete({
        where: { id },
      });
    } catch (error) {
      log.error("Failed to delete tag", error as Error);
      throw error;
    }
  }

  /**
   * Get the USER tag (used for marking user-uploaded resources)
   */
  async getOrCreateUserTag(): Promise<string> {
    try {
      const userTag = await prisma.tag.findFirst({
        where: { name: "User" },
      });

      if (userTag) {
        return userTag.id;
      }

      const newTag = await prisma.tag.create({
        data: {
          name: "User",
          slug: "user",
          group: "Source",
          source: "SYSTEM", // System-created tag for marking user uploads
        },
      });

      return newTag.id;
    } catch (error) {
      log.error("Failed to get/create USER tag", error as Error);
      throw new AppError("Failed to handle user tag", 500);
    }
  }
}

export const tagService = new TagService();
