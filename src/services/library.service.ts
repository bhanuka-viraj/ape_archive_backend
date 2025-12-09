
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
  async getLibraryHierarchy() {
    try {
      // Fetch all SYSTEM tags (folders)
      const tags = await prisma.tag.findMany({
        where: {
          source: "SYSTEM",
        },
        select: {
          id: true,
          name: true,
          parentId: true,
          group: true,
          slug: true
        },
        orderBy: { name: "asc" },
      });

      // Build Tree Map
      const tagMap = new Map<string, any>();
      const roots: any[] = [];

      // Initialize nodes
      tags.forEach(tag => {
        tagMap.set(tag.id, {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          group: tag.group, // Helpful for UI icons/logic
          children: []
        });
      });

      // Link parents
      tags.forEach(tag => {
        const node = tagMap.get(tag.id);
        if (tag.parentId && tagMap.has(tag.parentId)) {
          const parent = tagMap.get(tag.parentId);
          parent.children.push(node);
        } else {
          // If no parent (or parent not found/system), it's a root
          // Specifically for our Level structure, Levels have no parent.
          roots.push(node);
        }
      });

      return roots;
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
   * Order: STREAM -> SUBJECT -> GRADE -> MEDIUM -> RESOURCE_TYPE -> LESSON
   */
  private buildHierarchyPath(tagsByGroup: {
    [group: string]: string;
  }): string[] {
    const groupOrder = ["STREAM", "SUBJECT", "GRADE", "MEDIUM", "RESOURCE_TYPE", "LESSON"];
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
          result[key] = value.__resources as ResourceWithTags[];
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
   * Browse library - Strict Drill Down Mode
   * Uses Explicit Hierarchy (parentId) to navigate folders.
   */
  async browse(filters: Record<string, string>) {
    // 1. Resolve Current Node (Deepest Filter)
    const GROUP_MAPPING: Record<string, string> = {
        "RESOURCETYPE": "RESOURCE_TYPE",
        "MEDIUM": "MEDIUM", 
        "LESSON": "LESSON",
        "SUBJECT": "SUBJECT",
        "GRADE": "GRADE",
        "STREAM": "STREAM",
        "LEVEL": "LEVEL"
    };

    let currentParentId: string | null = null;
    let currentLevelName = "Library";
    
    const HIERARCHY_ORDER = ["LESSON", "RESOURCE_TYPE", "MEDIUM", "GRADE", "SUBJECT", "STREAM", "LEVEL"];
    
    for (const group of HIERARCHY_ORDER) {
        // Find key in filters that maps to this group
        const filterKey = Object.keys(filters).find(k => {
             const upper = k.toUpperCase();
             return (GROUP_MAPPING[upper] || upper) === group;
        });

        if (filterKey && filters[filterKey]) {
            const tagName = filters[filterKey];
            const tag = await prisma.tag.findFirst({
                where: { 
                    name: tagName,
                    group: group,
                    source: "SYSTEM"
                }
            });
            
            if (tag) {
                currentParentId = tag.id;
                currentLevelName = tag.name;
                break; // Stop at deepest provided tag
            }
        }
    }

    // 2. Fetch Children (Folders)
    const childTags = await prisma.tag.findMany({
        where: {
            parentId: currentParentId,
            source: "SYSTEM"
        },
        orderBy: { name: 'asc' }
    });

    // 3. Fetch Files (Resources) (Only if we have a parent or are at root?)
    // Usually only show files if we are inside a folder.
    let resources: any[] = [];
    if (currentParentId) {
        resources = await prisma.resource.findMany({
            where: {
                tags: { some: { id: currentParentId } },
                source: "SYSTEM",
                status: "APPROVED"
            },
            include: { tags: true },
            take: 200
        });
    }

    // 4. Transform to Response Format
    const groupedFolders: Record<string, any[]> = {};
    
    for (const tag of childTags) {
        const group = tag.group || "Other";
        if (!groupedFolders[group]) groupedFolders[group] = [];
        groupedFolders[group].push({
             id: tag.id,
             name: tag.name,
             slug: tag.slug
        });
    }
    
    // Explicitly exclude resources that are effectively "Folders" in disguise?
    // No, with parentId, only loose files are resources.
    
    // Filter logic: If a resource is also tagged with one of the *visible child tags*, 
    // it probably belongs inside that folder. We should hide it from the "Loose Files" list 
    // to avoid duplication (showing it as a file AND having it inside a folder).
    // HOWEVER, `parentId` logic implies strict ownership. 
    // We query `tags: { some: { id: currentParent } }`.
    // This gets ALL files in this folder.
    // DOES IT get files in subfolders? NO.
    // Because files in subfolders are tagged with the Subfolder ID, NOT the Parent ID (usually).
    // Wait. `processFolder` upserts resource with `currentContext.tagIds`.
    // `tagIds` accumulates ALL IDs in the path.
    // So a file deep down IS tagged with the top-level Subject.
    // So searching `some: { id: ParentID }` WILL return deep files too.
    // We need to filter out files that belong to any of the *Child Tags* we are about to show.
    
    const childTagIds = new Set(childTags.map(t => t.id));
    const looseResources: ResourceWithTags[] = [];
    
    for (const res of resources) {
        // If this resource is tagged with ANY of the immediate children, hide it.
        const isInsideSubfolder = res.tags.some((t: any) => childTagIds.has(t.id));
        if (!isInsideSubfolder) {
            looseResources.push(convertBigIntsToStrings(res) as ResourceWithTags);
        }
    }

    return {
        currentLevel: currentLevelName,
        folders: groupedFolders,
        resources: looseResources
    };
  }
}

export const libraryService = new LibraryService();