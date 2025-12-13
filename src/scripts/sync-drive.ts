
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { log } from "../utils/logger";
import { categorizeFolder } from "../utils/tag-patterns";

const prisma = new PrismaClient();

// Context to track where we are in the hierarchy
interface SyncContext {
  // Accumulates all valid HIERARCHY tag IDs encountered in the path
  tagIds: string[];
  // Tracks the immediate parent tag for the current folder (Hierarchy Parent)
  currentParentTagId?: string | null;
  currentParentSlug?: string | null; // Track parent slug for uniqueness
}

interface DriveSyncStats {
  foldersScanned: number;
  filesProcessed: number;
  filesSkipped: number; // Ignored (e.g. invalid type)
  filesUpserted: number; // Created or Updated
  tagsCreated: number;
  errorsEncountered: number;
  startTime: Date;
  endTime?: Date;
}

class DriveSync {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive;
  private stats: DriveSyncStats;
  private readonly API_DELAY_MS = 100; // Rate limiting
  private readonly FOLDER_MIME = "application/vnd.google-apps.folder";

  constructor() {
    this.oauth2Client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET
    );

    if (env.GOOGLE_REFRESH_TOKEN) {
      this.oauth2Client.setCredentials({
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
      });
    }

    this.drive = google.drive({
      version: "v3",
      auth: this.oauth2Client,
    });

    this.stats = {
      foldersScanned: 0,
      filesProcessed: 0,
      filesSkipped: 0,
      filesUpserted: 0,
      tagsCreated: 0,
      errorsEncountered: 0,
      startTime: new Date(),
    };
  }

  private async ensureTokenValid(): Promise<void> {
    try {
      const credentials = this.oauth2Client.credentials;
      if (!credentials.expiry_date || credentials.expiry_date < Date.now()) {
        log.debug("Refreshing OAuth2 token for sync");
        const response = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(response.credentials);
      }
    } catch (error) {
      log.error("Failed to refresh token during sync", error as Error);
      throw error;
    }
  }

  /**
   * Idempotently ensure a Tag exists in the DB (HIERARCHY TAGS ONLY)
   */
  private async ensureTag(name: string, group?: string, parentId?: string | null, parentSlug?: string | null): Promise<string> {
    const cleanName = name.trim();
    
    // Generate Context-Aware Slug
    let baseSlug = cleanName
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "");

    // If we have a parent context, prefix it to ensure uniqueness
    let finalSlug = baseSlug;
    if (parentSlug) {
        if (!baseSlug.startsWith(parentSlug)) {
            finalSlug = `${parentSlug}-${baseSlug}`;
        }
    }

    // Try to find by Slug first
    let tag = await prisma.tag.findFirst({
      where: { slug: finalSlug },
    });
    
    // Fallback: Check by Name AND ParentId
    if (!tag) {
        tag = await prisma.tag.findFirst({
            where: { 
                name: cleanName,
                parentId: parentId || null
            }
        });
    }

    if (!tag) {
      tag = await prisma.tag.create({
        data: {
          name: cleanName,
          slug: finalSlug,
          group: group || null,
          source: "SYSTEM",
          parentId: parentId || null // Strict Hierarchy
        },
      });
      this.stats.tagsCreated++;
    } else {
      // Upsert/Update logic ensure it stays consistent
      if (tag.group !== group || tag.parentId !== parentId || tag.slug !== finalSlug) {
         await prisma.tag.update({
             where: { id: tag.id },
             data: { 
                 group: group || tag.group,
                 parentId: parentId,
                 slug: finalSlug 
             }
         });
      }
    }
    return tag.id;
  }
  
  async getTagSlug(tagId: string): Promise<string | null> {
      const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { slug: true } });
      return tag?.slug || null;
  }

  private async delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.API_DELAY_MS));
  }

  /**
   * Recursive function to walk the Drive tree with Context
   */
  private async processFolder(
    folderId: string,
    currentContext: SyncContext,
    depth: number = 0
  ): Promise<void> {
    await this.ensureTokenValid();
    await this.delay();

    const indent = "  ".repeat(depth);
    log.debug(`${indent}Scanning folder ${folderId}...`);

    try {
      let pageToken: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const response = await this.drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          spaces: "drive",
          fields: "nextPageToken, files(id, name, mimeType, size)",
          pageSize: 100,
          pageToken,
        });

        const files = response.data.files || [];
        this.stats.filesProcessed += files.length;

        for (const file of files) {
          if (!file.id || !file.name) continue;

          await this.delay();

          if (file.mimeType === this.FOLDER_MIME) {
            this.stats.foldersScanned++;
            
            const name = file.name.trim();
            const nextContext: SyncContext = { ...currentContext, tagIds: [...currentContext.tagIds] };
            
            // --- NEW PATTERN ENGINE LOGIC ---
            const patternMatch = categorizeFolder(name);
            
            if (patternMatch) {
                // If it's a HIERARCHY folder (Level, Grade, Subject, Stream)
                if (patternMatch.isHierarchy) {
                    const parentId = currentContext.currentParentTagId; 
                    const parentSlug = currentContext.currentParentSlug;

                    const tagId = await this.ensureTag(name, patternMatch.group, parentId, parentSlug);
                    const tagSlug = await this.getTagSlug(tagId);

                    nextContext.tagIds.push(tagId);
                    nextContext.currentParentTagId = tagId;
                    nextContext.currentParentSlug = tagSlug;
                    
                    log.info(`${indent}[FOLDER] ${name} -> [${patternMatch.group}]`);
                    await this.processFolder(file.id, nextContext, depth + 1);

                } else {
                    // It is an ATTRIBUTE folder (Medium, Type)
                    // ACTION: IGNORE IT (Flatten Logic).
                    // We log it, but we do NOT create a tag, and we do NOT add to hierarchy context.
                    // The files inside will just inherit the CURRENT hierarchy context (e.g. Grade 10 id).
                    log.info(`${indent}[FLATTEN] Ignoring folder ${name} (Attribute: ${patternMatch.group})`);
                    // Continue recursing, but pass SAME context (skipping this folder layer)
                    await this.processFolder(file.id, currentContext, depth + 1); 
                }

            } else {
                // No Match -> Assume it is a GENERIC SUBJECT or LESSON (Hierarchy)
                // Default logic: If inside Grade, likely Subject. If inside Subject, likely Lesson.
                const group = "SUBJECT"; // Default safe fallback or "LESSON"
                // Actually, let's treat unknown folders as LESSIONS/TOPICS (Hierarchy)
                // unless we want to be strict.
                
                const parentId = currentContext.currentParentTagId;
                const parentSlug = currentContext.currentParentSlug;
                
                // Let's call it 'LESSON' to be safe for deep nesting
                const tagId = await this.ensureTag(name, "LESSON", parentId, parentSlug);
                const tagSlug = await this.getTagSlug(tagId);

                nextContext.tagIds.push(tagId);
                nextContext.currentParentTagId = tagId;
                nextContext.currentParentSlug = tagSlug;

                log.info(`${indent}[FOLDER] ${name} -> [LESSON/GENERIC]`);
                await this.processFolder(file.id, nextContext, depth + 1);
            }

          } else {
            // Process File
            await this.upsertFileResource(file, currentContext.tagIds, indent);
          }
        }

        pageToken = response.data.nextPageToken || undefined;
        hasMore = !!pageToken;
      }
    } catch (error) {
       console.error(`❌ FATAL ERROR processing folder ${folderId}:`, error);
       log.error(`${indent}Error processing folder`, error as Error);
       this.stats.errorsEncountered++;
    }
  }

  /**
   * Create or Update Resource with SAFE MERGE Logic
   */
  private async upsertFileResource(
    file: drive_v3.Schema$File, 
    hierarchyTagIds: string[], 
    indent: string
  ): Promise<void> {
    try {
      if (!file.id || !file.name) return;
      const mimeType = file.mimeType || "application/octet-stream";
      const fileSize = file.size ? BigInt(file.size) : null;

      // Check existence
      const existing = await prisma.resource.findFirst({
        where: { driveFileId: file.id },
        include: { tags: true }
      });

      if (existing) {
        // SAFE MERGE:
        // 1. Identify existing Attribute Tags (parentId: null) -> PRESERVE THEM
        // 2. Identify new Hierarchy Tags (passed in arg) -> USE THEM (Overwrite old hierarchy)
        
        const existingAttributeTags = existing.tags.filter(t => t.parentId === null);
        const attributeTagIds = existingAttributeTags.map(t => t.id);
        
        // Final List = New Hierarchy IDs + Old Attribute IDs
        // Use Set to dedup just in case
        const finalTagIds = Array.from(new Set([...hierarchyTagIds, ...attributeTagIds]));

        await prisma.resource.update({
          where: { id: existing.id },
          data: {
            title: file.name,
            tags: {
              set: finalTagIds.map(id => ({ id }))
            }
          }
        });
        // log.debug(`${indent}[UPDATED] ${file.name} (Preserved ${attributeTagIds.length} attributes)`);
      } else {
        // CREATE
        await prisma.resource.create({
          data: {
            title: file.name,
            description: `Synced from Drive`,
            driveFileId: file.id,
            mimeType,
            fileSize,
            uploaderId: "system-sync",
            status: "APPROVED", 
            source: "SYSTEM",
            tags: {
              connect: hierarchyTagIds.map(id => ({ id }))
            }
          }
        });
        log.info(`${indent}[NEW] ${file.name}`);
      }
      
      this.stats.filesUpserted++;

    } catch (error) {
      log.error(`${indent}Failed to upsert file: ${file.name}`, error as Error);
      this.stats.errorsEncountered++;
    }
  }

  public async sync(): Promise<void> {
    try {
      log.info("🚀 Starting Smart Drive Sync (Hybrid Architecture)...");
      
      if (!env.ROOT_FOLDER_ID) {
        throw new Error("ROOT_FOLDER_ID not configured.");
      }

      await prisma.user.upsert({
        where: { id: "system-sync" },
        update: {},
        create: {
          id: "system-sync",
          email: "system-sync@apeArchive.com",
          name: "System Bot",
          role: "ADMIN",
          isOnboarded: true,
        },
      });

      // Start Crawl with Empty Context
      await this.processFolder(env.ROOT_FOLDER_ID, { tagIds: [] });

      this.stats.endTime = new Date();
      this.printSummary();

    } catch (error) {
      log.error("Sync failed fatal", error as Error);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }

  private printSummary(): void {
    const duration =
      this.stats.endTime && this.stats.startTime
        ? this.stats.endTime.getTime() - this.stats.startTime.getTime()
        : 0;

    console.log("\n");
    console.log("╔════════════════════════════════════════╗");
    console.log("║            Sync Complete               ║");
    console.log("╚════════════════════════════════════════╝");
    console.log(`\n📊 Statistics:`);
    console.log(`  ├─ Folders Scanned: ${this.stats.foldersScanned}`);
    console.log(`  ├─ Files Processed: ${this.stats.filesProcessed}`);
    console.log(`  ├─ Files Synced: ${this.stats.filesUpserted}`);
    console.log(`  ├─ Errors: ${this.stats.errorsEncountered}`);
    console.log(`  └─ Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log("\n");
  }
}

if (import.meta.main) {
  new DriveSync().sync();
}

export { DriveSync };
