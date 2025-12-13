
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
          // Only add valid Hierarchy Roots (LEVELs) to the top of the tree response
          if (tag.group === "LEVEL") {
            roots.push(node);
          }
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

    // 1. Determine Current Context (Drill Down) - Flexible Path Resolution
    // Instead of enforcing a strict Group Order, we greedily follow the chain.
    // This supports both "Grade -> Subject" and "Subject -> Grade" folder structures.

    let currentParentId: string | null = null;
    let currentLevelName = "Library";
    
    // Convert filters to a consumable set of { slug/name } candidates
    // We ignore empty values and keys that aren't mapped
    const candidateTags = new Set<string>();
    Object.keys(filters).forEach(key => {
        if (filters[key]) candidateTags.add(filters[key].toLowerCase());
    });

    // Max depth to prevent infinite loops (though unlikely with finite inputs)
    let depth = 0;
    while (candidateTags.size > 0 && depth < 10) {
        depth++;
        
        // Find ANY tag that:
        // 1. Matches one of our candidate names/slugs
        // 2. Is a child of the currentParentId
        const nextNode = await prisma.tag.findFirst({
            where: {
                parentId: currentParentId,
                source: "SYSTEM",
                OR: [
                    { name: { in: Array.from(candidateTags), mode: 'insensitive' } },
                    { slug: { in: Array.from(candidateTags), mode: 'insensitive' } }
                ]
            }
        });

        if (nextNode) {
            // Found a match! Advance the path.
            currentParentId = nextNode.id;
            currentLevelName = nextNode.name;
            
            // Remove the found tag from candidates to stop re-matching it
            // We remove by Name AND Slug to be safe
            candidateTags.delete(nextNode.name.toLowerCase());
            candidateTags.delete(nextNode.slug.toLowerCase());
            // Also need to remove identifying original input if it differed slightly? 
            // The logic above used 'in' query, so we don't know exactly which input str matched.
            // But since we are drilling down, picking the *first valid child* is correct behavior.
            
            // Optimization: We could filter the Set based on the match, but simpler to just loop.
            // Since we don't know exact Key, we rely on the fact that the Tree Structure is unique enough.
            // Wait, if we have duplicate names in params? (Unlikely).
            
            // Better removal logic:
            // We matched `nextNode`. We should perform a fresh search in the next iteration.
            // We need to ensure we don't match the SAME node again? 
            // `parentId` changes, so we won't match the same node ID.
            // But if we have "Grade 6" (Parent) and "Grade 6" (Child)... (Not valid hierarchy).
            
            // Actually, we must remove the matched candidate to allow finding *other* tags.
            // But we can't easily map back to the input string found.
            // Let's iterate the Set and remove the one that matches.
             for (const c of candidateTags) {
                if (c === nextNode.name.toLowerCase() || c === nextNode.slug.toLowerCase()) {
                    candidateTags.delete(c);
                }
            }
        } else {
            // No candidates match as a child of the current node.
            // We have reached as deep as we can go with the provided filters.
            break;
        }
    }

    // 2. Fetch Children (Hierarchy Folders)
    const childTags = await prisma.tag.findMany({
        where: {
            parentId: currentParentId,
            source: "SYSTEM"
        },
        orderBy: { name: 'asc' }
    });

    // 3. Fetch Files (Resources) at this level
    // Logic: Get ALL resources tagged with currentParentId.
    // Optimization: If we have child folders, we normally hide files that are inside those children.
    
    const childTagIds = new Set(childTags.map(t => t.id));
    
    // Fetch a subset of resources to determine available facets
    // If we are at Root (currentParentId is null), likely minimal resources, but let's be safe.
    // If currentParentId exists, we can fetch all Approved System resources.
    
    const resourceQuery: any = {
        source: "SYSTEM",
        status: "APPROVED"
    };
    
    if (currentParentId) {
        resourceQuery.tags = { some: { id: currentParentId } };
    } else {
        // At root, maybe restricts to only resources with NO hierarchy tags? 
        // Or just don't return facets at root to avoid scanning DB.
    }

    const resources = await prisma.resource.findMany({
        where: resourceQuery,
        include: { tags: true },
        take: 500 // Limit for performance, but enough to get facets
    });

    // 4. Separate Loose Files vs Files in Subfolders
    // And Collect Facets/Attributes from the loose files
    const looseResources: ResourceWithTags[] = [];
    const attributeCounts: Record<string, Record<string, number>> = {}; // Group -> TagName -> Count

    for (const res of resources) {
        // Is it inside a visible subfolder?
        // (i.e. does it have a tag that matches one of our child folders?)
        const isInsideSubfolder = childTags.length > 0 && res.tags.some((t: any) => childTagIds.has(t.id));

        if (!isInsideSubfolder) {
            looseResources.push(convertBigIntsToStrings(res) as ResourceWithTags);
            
            // Collect Attributes from THIS loose file for Facets
            res.tags.forEach(tag => {
                if (!tag.group) return;
                // Ignore Hierarchy Groups (we are browsing them via folders)
                if (["LEVEL", "STREAM", "GRADE", "SUBJECT", "LESSON"].includes(tag.group)) return;
                
                // It is an Attribute (Medium, ResourceType, etc)
                if (!attributeCounts[tag.group]) attributeCounts[tag.group] = {};
                if (!attributeCounts[tag.group][tag.name]) attributeCounts[tag.group][tag.name] = 0;
                attributeCounts[tag.group][tag.name]++;
            });
        }
    }

    // 5. Transform Response
    const groupedFolders: Record<string, any[]> = {};
    for (const tag of childTags) {
        const group = tag.group || "Navigation";
        if (!groupedFolders[group]) groupedFolders[group] = [];
        groupedFolders[group].push({
             id: tag.id,
             name: tag.name,
             slug: tag.slug
        });
    }

    // Format facets
    const facets: Record<string, any[]> = {};
    for (const [group, counts] of Object.entries(attributeCounts)) {
        facets[group] = Object.entries(counts).map(([name, count]) => ({ name, count }));
    }

    return {
        currentLevel: currentLevelName,
        folders: groupedFolders,
        facets: facets, // <-- NEW: Available Attribute Tags for filtering
        resources: looseResources
    };
  }
}

export const libraryService = new LibraryService();