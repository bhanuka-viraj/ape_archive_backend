import { prisma } from "../config/database";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";
import { convertBigIntsToStrings } from "../utils/bigint-handler";
import { ResourceSource } from "@prisma/client";

interface ResourceWithTags {
  id: string;
  title: string;
  description: string | null;
  driveFileId: string | null;
  mimeType: string | null;
  views: number;
  downloads: number;
  tags: Array<{
    id: string;
    name: string;
    group: string | null;
  }>;
}

interface HierarchyNode {
  [key: string]: HierarchyNode | ResourceWithTags[];
}

class LibraryService {
  /**
   * Get library resources grouped by tag hierarchy
   * Only returns SYSTEM resources (migrated + admin-uploaded)
   */
  async getLibraryHierarchy(): Promise<HierarchyNode> {
    try {
      const resources = await prisma.resource.findMany({
        where: {
          source: "SYSTEM",
          status: "APPROVED",
        },
        include: {
          tags: {
            select: {
              id: true,
              name: true,
              group: true,
            },
            where: {
              source: "SYSTEM",
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      // Build hierarchy tree
      const hierarchy: HierarchyNode = {};

      for (const resource of resources) {
        // Get tags organized by group
        const tagsByGroup = this.organizeTagsByGroup(resource.tags);

        // Build the path through the hierarchy
        const path = this.buildHierarchyPath(tagsByGroup);

        // Navigate/create the nested structure
        let current: any = hierarchy;
        for (const segment of path) {
          if (!current[segment]) {
            current[segment] = {};
          }
          current = current[segment];
        }

        // Add resource to the final level
        if (!current.__resources) {
          current.__resources = [];
        }
        current.__resources.push({
          id: resource.id,
          title: resource.title,
          description: resource.description,
          driveFileId: resource.driveFileId,
          mimeType: resource.mimeType,
          views: resource.views,
          downloads: resource.downloads,
          tags: resource.tags,
        });
      }

      // Clean up the structure by moving __resources arrays
      return convertBigIntsToStrings(this.cleanHierarchy(hierarchy));
    } catch (error) {
      log.error("Failed to get library hierarchy", error as Error);
      throw new AppError("Failed to fetch library", 500);
    }
  }

  /**
   * Organize tags by their group field
   */
  private organizeTagsByGroup(
    tags: Array<{ id: string; name: string; group: string | null }>
  ): { [group: string]: string } {
    const organized: { [group: string]: string } = {};
    for (const tag of tags) {
      if (tag.group) {
        organized[tag.group] = tag.name;
      }
    }
    return organized;
  }

  /**
   * Build hierarchy path from tags
   * Order: Grade → Subject → Lesson → Medium → ResourceType
   */
  private buildHierarchyPath(tagsByGroup: {
    [group: string]: string;
  }): string[] {
    const groupOrder = ["Grade", "Subject", "Lesson", "Medium", "ResourceType"];
    const path: string[] = [];

    for (const group of groupOrder) {
      if (tagsByGroup[group]) {
        path.push(tagsByGroup[group]);
      }
    }

    return path.length > 0 ? path : ["Uncategorized"];
  }

  /**
   * Clean up hierarchy by removing __resources markers and properly structuring
   */
  private cleanHierarchy(node: any): HierarchyNode {
    const result: HierarchyNode = {};

    for (const [key, value] of Object.entries(node)) {
      if (key === "__resources") {
        // Skip internal marker
        continue;
      }

      if (Array.isArray(value)) {
        // This is a resources array
        result[key] = value;
      } else if (typeof value === "object" && value !== null) {
        // Recursively clean nested objects
        const cleaned = this.cleanHierarchy(value);

        // If this object has __resources, move it to the key
        if ("__resources" in value) {
          result[key] = value.__resources;
        } else {
          result[key] = cleaned;
        }
      }
    }

    return result;
  }

  /**
   * Get available tags for admin upload (SYSTEM tags grouped by group)
   */
  async getAvailableTagsForUpload() {
    try {
      const tags = await prisma.tag.findMany({
        where: {
          source: "SYSTEM",
        },
        orderBy: [{ group: "asc" }, { name: "asc" }],
      });

      const grouped: { [group: string]: Array<{ id: string; name: string }> } =
        {};
      for (const tag of tags) {
        const groupName = tag.group || "Other";
        if (!grouped[groupName]) {
          grouped[groupName] = [];
        }
        grouped[groupName].push({
          id: tag.id,
          name: tag.name,
        });
      }

      return grouped;
    } catch (error) {
      log.error("Failed to get available tags", error as Error);
      throw new AppError("Failed to fetch tags", 500);
    }
  }

  /**
   * Browse library with tag filters (AND logic)
   * Supports filters: stream, subject, grade, medium, resourceType
   * Returns hierarchical structure with pagination
   */
  async browseLibrary(filters: {
    stream?: string;
    subject?: string;
    grade?: string;
    medium?: string;
    resourceType?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    hierarchy: HierarchyNode;
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const skip = (page - 1) * limit;

      // Build tag name filter conditions (AND logic)
      const tagNameConditions: string[] = [];
      if (filters.stream) tagNameConditions.push(filters.stream);
      if (filters.subject) tagNameConditions.push(filters.subject);
      if (filters.grade) tagNameConditions.push(filters.grade);
      if (filters.medium) tagNameConditions.push(filters.medium);
      if (filters.resourceType) tagNameConditions.push(filters.resourceType);

      // Query resources that match ALL specified tag names
      const resources = await prisma.resource.findMany({
        where: {
          source: "SYSTEM",
          status: "APPROVED",
          ...(tagNameConditions.length > 0 && {
            tags: {
              every: {
                name: {
                  in: tagNameConditions,
                },
              },
            },
          }),
        },
        include: {
          tags: {
            select: {
              id: true,
              name: true,
              group: true,
            },
            where: {
              source: "SYSTEM",
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      // Get total count for pagination
      const total = resources.length;

      // Apply pagination to resources
      const paginatedResources = resources.slice(skip, skip + limit);

      // Build hierarchy tree from paginated resources
      const hierarchy: HierarchyNode = {};

      for (const resource of paginatedResources) {
        const tagsByGroup = this.organizeTagsByGroup(resource.tags);
        const path = this.buildHierarchyPath(tagsByGroup);

        let current: any = hierarchy;
        for (const segment of path) {
          if (!current[segment]) {
            current[segment] = {};
          }
          current = current[segment];
        }

        if (!current.__resources) {
          current.__resources = [];
        }
        current.__resources.push({
          id: resource.id,
          title: resource.title,
          description: resource.description,
          driveFileId: resource.driveFileId,
          mimeType: resource.mimeType,
          views: resource.views,
          downloads: resource.downloads,
          tags: resource.tags,
        });
      }

      return {
        hierarchy: convertBigIntsToStrings(this.cleanHierarchy(hierarchy)),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      log.error("Failed to browse library", error as Error);
      throw new AppError("Failed to browse library", 500);
    }
  }
}

export const libraryService = new LibraryService();
