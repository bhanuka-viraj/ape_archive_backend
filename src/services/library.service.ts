
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
   * Determines the next level based on what filters are present.
   * Standard: STREAM -> SUBJECT -> GRADE -> MEDIUM
   * Mixed Layer: LESSON folders + Global RESOURCE_TYPE folders
   */
  async browse(filters: Record<string, string>) {
    // 1. Parameter Normalization
    const GROUP_MAPPING: Record<string, string> = {
        "RESOURCETYPE": "RESOURCE_TYPE",
        "MEDIUM": "MEDIUM", 
        "LESSON": "LESSON",
        "SUBJECT": "SUBJECT",
        "GRADE": "GRADE",
        "STREAM": "STREAM"
    };

    const inputKeys = new Set(
        Object.keys(filters).map(k => {
            const upper = k.toUpperCase();
            return GROUP_MAPPING[upper] || upper;
        })
    );

    // 2. Standard Hierarchy Levels (Up to Medium)
    const STANDARD_HIERARCHY = ["STREAM", "SUBJECT", "GRADE", "MEDIUM"];
    
    // Determine target from standard hierarchy first
    let targetGroup: string | null = null;
    
    for (const level of STANDARD_HIERARCHY) {
      if (!inputKeys.has(level)) {
        targetGroup = level;
        break;
      }
    }

    // 3. Custom Logic for Post-Medium (Lesson vs Resource Type)
    // If standard hierarchy is complete (we have Medium), we enter the "Mixed Layer"
    const standardComplete = !targetGroup;
    
    let isLessonLevel = false;        // Are we at the level of choosing a Lesson?
    
    if (standardComplete) {
        const hasLesson = inputKeys.has("LESSON");
        const hasResourceType = inputKeys.has("RESOURCE_TYPE");
        
        if (!hasLesson && !hasResourceType) {
            // Level: Medium Selected. 
            // Show: Lessons (Folders) + Global Resource Types (Folders)
            isLessonLevel = true; 
        } else if (hasLesson && !hasResourceType) {
            // Level: Lesson Selected (e.g. Unit 1).
            // Show: Resource Types inside this lesson (e.g. Notes)
            targetGroup = "RESOURCE_TYPE";
        } else {
            // Either ResourceType selected (Global) OR Lesson+ResourceType selected.
            // Show: Files (Leaf)
        }
    }

    // 4. Build Query
    const conditions = Object.entries(filters)
      .filter(([key, val]) => val && key !== 'page' && key !== 'limit')
      .map(([key, name]) => {
          const upperKey = key.toUpperCase();
          const dbGroup = GROUP_MAPPING[upperKey] || upperKey;
          return {
            tags: { some: { name: name, group: dbGroup } }
          };
      });

    const where = {
      source: "SYSTEM",
      status: "APPROVED",
      ...(conditions.length > 0 && { AND: conditions }),
    };

    // 4. Fetch Resources
    const resources = await prisma.resource.findMany({
      where: where as any,
      include: {
        tags: true
      },
      take: 200
    });


    // 5. Extract Tags (Folders) and Loose Files
    const nextOptions = new Set<string>();
    const looseResources: ResourceWithTags[] = [];
    
    // Logic:
    // If targetGroup is set (Standard or Lesson-Inside-Type), collect those tags.
    // If isLessonLevel (Mixed): Collect LESSON tags AND Global RESOURCE_TYPE tags.
    
    for (const res of resources) {
      let isInsideFolder = false;

      if (targetGroup) {
          // Standard single-target extraction
          const tag = res.tags.find(t => t.group === targetGroup && t.source === "SYSTEM");
          if (tag) {
              nextOptions.add(tag.name);
              isInsideFolder = true;
          }
      } else if (isLessonLevel) {
          // Mixed Level: "Unit 1" OR "Syllabus"
          // Priority 1: Check for LESSON tag (SYSTEM only)
          const lessonTag = res.tags.find(t => t.group === "LESSON" && t.source === "SYSTEM");
          if (lessonTag) {
              nextOptions.add(lessonTag.name);
              isInsideFolder = true; 
          } else {
              // Priority 2: If NO Lesson tag, check for RESOURCE_TYPE tag (Global item) (SYSTEM only)
              const typeTag = res.tags.find(t => t.group === "RESOURCE_TYPE" && t.source === "SYSTEM");
              if (typeTag) {
                  nextOptions.add(typeTag.name);
                  isInsideFolder = true;
              }
          }
      }

      // precise "File Manager" behavior:
      // If it's inside a sub-folder, we DON'T show it as a loose file.
      if (!isInsideFolder) {
         looseResources.push({
            id: res.id,
            title: res.title,
            description: res.description,
            driveFileId: res.driveFileId,
            mimeType: res.mimeType,
            views: res.views,
            downloads: res.downloads,
            tags: res.tags
         });
      }
    }

    // Auto-Skip Logic / Dead End Handling
    let finalGroup = targetGroup;
    const finalOptions = Array.from(nextOptions).sort();
    let finalResources = looseResources;

    // If we are at a folder level but found no folders...
    // And we have loose files. 
    // Usually means we hit bottom.
    // But check the Auto-Skip (Stream -> Subject) logic?
    // Simplified: If standard hierarchy target was missing (e.g. Stream) but we have files?
    if (targetGroup && STANDARD_HIERARCHY.includes(targetGroup) && finalOptions.length === 0 && finalResources.length > 0) {
        // Try skipping to next standard level?
        const idx = STANDARD_HIERARCHY.indexOf(targetGroup);
        if (idx < STANDARD_HIERARCHY.length - 1) {
            const nextStandard = STANDARD_HIERARCHY[idx + 1];
            // Check availability
            const skiplist = new Set<string>();
            const nextResources: any[] = [];
            for (const res of finalResources) {
                const tag = res.tags.find((t: any) => t.group === nextStandard && t.source === "SYSTEM");
                if (tag) {
                    skiplist.add(tag.name);
                } else {
                    nextResources.push(res);
                }
            }
            if (skiplist.size > 0) {
                finalGroup = nextStandard;
                finalOptions.length = 0;
                finalOptions.push(...Array.from(skiplist).sort());
                finalResources = nextResources;
            }
        }
    }
    
    // Force resources if dead end or if we are purely showing files
    // If standardComplete and no specific level active (Leaf), show resources.
    const showFiles = (!targetGroup && !isLessonLevel) || (finalOptions.length === 0);
    
    if (showFiles && finalResources.length === 0 && resources.length > 0) {
          // If we filtered out everything but decided to show files, bring them back?
          // Actually finalResources contains what failed "isInsideFolder".
          // If we are at Lead node, isInsideFolder is always false (no target).
          // So finalResources has them.
      resources: showFiles || finalResources.length > 0 ? finalResources : [] // Always try to show files if folders are empty or logic dictates
    };
  }

  // Deprecated/Legacy
  async browseLibrary(filters: any) {
     return this.browse(filters);
  }
}

export const libraryService = new LibraryService();
