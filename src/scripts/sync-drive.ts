
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { log } from "../utils/logger";

const prisma = new PrismaClient();

// Context to track where we are in the hierarchy
interface SyncContext {
  streamId?: string;
  subjectId?: string;
  gradeId?: string;
  mediumId?: string;
  // Accumulates all valid tag IDs encountered in the path
  tagIds: string[];
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
   * Idempotently ensure a Tag exists in the DB
   */
  private async ensureTag(name: string, group: string): Promise<string> {
    try {
      // Create a URL-friendly slug
      const slug = name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]/g, "");

      const tag = await prisma.tag.upsert({
        where: { slug },
        update: {}, // If exists, do nothing (idempotent)
        create: {
          name: name.trim(),
          slug,
          group,
          source: "SYSTEM", // Mark as system-generated
        },
      });

      // Only count as "created" if it was barely created? 
      // Upsert doesn't tell us, but that's fine for stats.
      // We could check createdAt, but let's keep it simple.
      
      return tag.id;
    } catch (error) {
      log.error("Error ensuring tag", { name, group, error });
      this.stats.errorsEncountered++;
      throw error;
    }
  }

  /**
   * Safe delay to avoid hitting rate limits
   */
  private async delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.API_DELAY_MS));
  }

  /**
   * Heuristics to identify folder type based on name
   */
  private isStreamName(name: string): boolean {
    // Anchored Strict Stream Check
    // Includes "Science Stream" AND "O/L Subjects", "Primary Class Subjects" (acting as Streams)
    if (/^A\/L Subjects$/i.test(name)) return false; // Special Case: A/L Subjects is a CONTAINER, not a Stream
    
    return /^(science|commerce|arts|tech)(?:\s+stream)?$/i.test(name) || 
           /stream$/i.test(name) ||
           /subjects$/i.test(name); // "O/L Subjects", "6-9 Class Subjects"
  }

  private isGradeName(name: string): boolean {
    // Anchored Grade Check
    return /^(grade\s+\d+|grade\s+1[0-3]|o\/l|a\/l|ordinary\s+level|advanced\s+level)/i.test(name);
  }

  private isMediumName(name: string): boolean {
    // Anchored Medium Check - MUST start with language
    return /^(english|sinhala|tamil|urdu|french|japanese)(?:\s+medium)?$/i.test(name);
  }
  
  private isLessonName(name: string): boolean {
    // Expanded Lesson Check
    return /^(unit|lesson|chapter|module|section|topic|week|day|part)(\s+\d+)?/i.test(name) ||
           /^\d+[\.\-\—\s]/i.test(name); // "01. Introduction"
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
            
            const name = file.name;
            
            // --- CONTEXT AWARE TAGGING LOGIC ---
            const nextContext: SyncContext = { 
              ...currentContext, 
              tagIds: [...currentContext.tagIds] // Clone array
            };

            // --- SPECIAL CASE: CONTAINER FOLDERS ---
            // "A/L Subjects" contains Streams (Art Stream, Science Stream)
            // We just want to traverse into it without assigning a tag itself.
            if (/^A\/L Subjects$/i.test(name)) {
                 log.info(`${indent}[CONTAINER] ${name} -> Skipping Tag, Traversing...`);
                 await this.processFolder(file.id, nextContext, depth + 1);
                 continue;
            }
            let tagGroup = "SUBJECT"; // Default fallback
            let tagId: string | undefined;

            // Determine what this folder represents based on what we are missing
            if (!nextContext.streamId && this.isStreamName(name)) {
              tagGroup = "STREAM";
              tagId = await this.ensureTag(name, tagGroup);
              nextContext.streamId = tagId;
            } 
            else if (!nextContext.subjectId) {
              // If we don't have a Subject yet, and this ISN'T a Stream, it must be valid Subject
              // (e.g. "General English" or "Accounting" inside Commerce Stream)
              tagGroup = "SUBJECT";
              // Exception: If it looks like a Grade, maybe we skipped Subject? 
              // But usually structure is strict. Let's assume it is Subject.
              tagId = await this.ensureTag(name, tagGroup);
              nextContext.subjectId = tagId;
            }
            else if (!nextContext.gradeId) {
              if (this.isGradeName(name)) {
                tagGroup = "GRADE";
                tagId = await this.ensureTag(name, tagGroup);
                nextContext.gradeId = tagId;
              } else {
                 // Warning: Folder found where Grade expected, but doesn't look like Grade
                 log.warn(`${indent}[WARN] Expected Grade, found: ${name}`);
              }
            }
            else if (!nextContext.mediumId) {
              if (this.isMediumName(name)) {
                tagGroup = "MEDIUM";
                tagId = await this.ensureTag(name, tagGroup);
                nextContext.mediumId = tagId;
              } else {
                 log.warn(`${indent}[WARN] Expected Medium, found: ${name}`);
              }
            }
            else {
              // We are deep (Level 5+). Content organization.
              if (this.isLessonName(name)) {
                tagGroup = "LESSON";
              } else {
                tagGroup = "RESOURCE_TYPE";
              }
              tagId = await this.ensureTag(name, tagGroup);
              // We track lessons/resource types in tagIds list, 
              // but we don't need specific context fields for them anymore
            }

            if (tagId) {
              nextContext.tagIds.push(tagId);
              log.info(`${indent}[FOLDER] ${name} -> [${tagGroup}]`);
            }

            // Recurse
            await this.processFolder(file.id, nextContext, depth + 1);

          } else {
            // --- FILE PROCESSING (IDEMPOTENT UPSERT) ---
            await this.upsertFileResource(file, currentContext.tagIds, indent);
          }
        }

        pageToken = response.data.nextPageToken || undefined;
        hasMore = !!pageToken;
      }
    } catch (error) {
      log.error(`${indent}Error processing folder`, error as Error);
      this.stats.errorsEncountered++;
    }
  }

  /**
   * Create or Update File Resource
   */
  private async upsertFileResource(
    file: drive_v3.Schema$File, 
    tagIds: string[], 
    indent: string
  ): Promise<void> {
    try {
      if (!file.id || !file.name) return;

      const mimeType = file.mimeType || "application/octet-stream";
      const fileSize = file.size ? BigInt(file.size) : null;

      // Check existence
      const existing = await prisma.resource.findFirst({
        where: { driveFileId: file.id },
        include: { tags: { select: { id: true } } }
      });

      if (existing) {
        // UPDATE: Sync tags and metadata (Handle Moves)
        // Only update if tags have changed to save DB writes? 
        // For simplicity, we just update. Prisma is smart.
        await prisma.resource.update({
          where: { id: existing.id },
          data: {
            title: file.name, // In case name changed in Drive
            tags: {
              set: tagIds.map(id => ({ id })) // Replace old tags with new context
            }
          }
        });
        // log.debug(`${indent}[UPDATED] ${file.name}`); 
      } else {
        // CREATE: New import
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
              connect: tagIds.map(id => ({ id }))
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
      log.info("🚀 Starting Smart Drive Sync...");
      
      if (!env.ROOT_FOLDER_ID) {
        throw new Error("ROOT_FOLDER_ID not configured.");
      }

      // Ensure system user exists
      await prisma.user.upsert({
        where: { id: "system-sync" },
        update: {},
        create: {
          id: "system-sync",
          email: "system-sync@resilientlearn.com",
          name: "System Bot",
          role: "ADMIN",
          isOnboarded: true,
        },
      });

      // Start Crawl
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
    console.log("║      Smart Sync Complete               ║");
    console.log("╚════════════════════════════════════════╝");
    console.log(`\n📊 Statistics:`);
    console.log(`  ├─ Folders Scanned: ${this.stats.foldersScanned}`);
    console.log(`  ├─ Files Processed: ${this.stats.filesProcessed}`);
    console.log(`  ├─ Files Synced (Upserted): ${this.stats.filesUpserted}`);
    console.log(`  ├─ Errors: ${this.stats.errorsEncountered}`);
    console.log(`  └─ Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log("\n");
  }
}

// Run if executed directly
if (import.meta.main) {
  new DriveSync().sync();
}

export { DriveSync };
