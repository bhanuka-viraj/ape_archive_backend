import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { log } from "../utils/logger";
// TODO: Update sync-drive.ts to use tags instead of CategoryType

const prisma = new PrismaClient();

interface SyncContext {
  streamId?: number;
  subjectId?: number;
  gradeId?: number;
  mediumId?: number;
  lessonId?: number;
  resourceTypeId?: number;
}

interface DriveSyncStats {
  foldersScanned: number;
  filesProcessed: number;
  filesSkipped: number;
  filesImported: number;
  categoriesCreated: number;
  errorsEncountered: number;
  startTime: Date;
  endTime?: Date;
}

class DriveSync {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive;
  private stats: DriveSyncStats;
  private readonly API_DELAY_MS = 100; // Rate limiting delay between API calls

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
      filesImported: 0,
      categoriesCreated: 0,
      errorsEncountered: 0,
      startTime: new Date(),
    };
  }

  /**
   * Ensure token is fresh before API calls
   */
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
   * Get or create a category
   */
  private async ensureCategory(
    name: string,
    type: CategoryType
  ): Promise<number> {
    try {
      const slug = name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]/g, "");

      const category = await prisma.category.upsert({
        where: { slug },
        update: {}, // No update needed if exists
        create: {
          name: name.trim(),
          slug,
          type,
        },
      });

      if (category) {
        this.stats.categoriesCreated++;
      }

      return category.id;
    } catch (error) {
      log.error("Error ensuring category", { name, type, error });
      this.stats.errorsEncountered++;
      throw error;
    }
  }

  /**
   * Detect category type based on folder name
   */
  private detectCategoryType(folderName: string): CategoryType {
    const name = folderName.toLowerCase().trim();

    // Priority 1: Check for Stream patterns (Science, Commerce, Arts, Tech)
    if (/(stream|science|commerce|arts|tech)/i.test(name)) {
      return CategoryType.STREAM;
    }

    // Priority 2: Check for Resource Type patterns (Syllabus, Teachers Guide, Past Papers, etc.)
    if (
      /^(syllabus|teacher'?s?\s*guide|past\s*papers?|model\s*papers?|notes?|short\s*notes?|ගුරු\s*මාර්ගෝපදේශ|පාඩම්\s*මාලාව)$/i.test(
        name
      )
    ) {
      return CategoryType.RESOURCE_TYPE;
    }

    // Priority 3: Check for Grade patterns (O/L, A/L, Grade 1-13, etc.)
    if (
      /^(grade\s+[1-9]|grade\s+1[0-3]|o\/l|a\/l|ol|al|ordinary|advanced)$/i.test(
        name
      )
    ) {
      return CategoryType.GRADE;
    }

    // Priority 4: Check for Medium/Language patterns
    if (
      /^(english|sinhala|tamil|urdu|french|spanish|german|mandarin|japanese|medium)$/i.test(
        name
      )
    ) {
      return CategoryType.MEDIUM;
    }

    // Priority 5: Check for Lesson/Unit patterns with numbered prefixes
    if (
      /^(unit|lesson|chapter|module|section|topic|week|day|part)(\s+\d+)?|^\d+[\.\-\—\s].*$/i.test(
        name
      )
    ) {
      return CategoryType.LESSON;
    }

    // Default to SUBJECT
    return CategoryType.SUBJECT;
  }

  /**
   * Check if a file already exists in the database
   */
  private async fileExists(driveFileId: string): Promise<boolean> {
    try {
      const existing = await prisma.resource.findFirst({
        where: { driveFileId },
      });
      return !!existing;
    } catch (error) {
      log.error("Error checking if file exists", error as Error);
      return false;
    }
  }

  /**
   * Add rate limiting delay
   */
  private async delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.API_DELAY_MS));
  }

  /**
   * Recursively crawl folder structure and sync resources
   */
  private async crawlFolder(
    folderId: string,
    context: SyncContext,
    depth: number = 0
  ): Promise<void> {
    await this.ensureTokenValid();
    await this.delay();

    const indent = "  ".repeat(depth);
    log.debug(`${indent}Scanning folder...`, { folderId, context });

    try {
      let pageToken: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const response = await this.drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          spaces: "drive",
          fields:
            "nextPageToken, files(id, name, mimeType, webViewLink, size, createdTime, modifiedTime)",
          pageSize: 100,
          pageToken,
        });

        const files = response.data.files || [];
        this.stats.filesProcessed += files.length;

        for (const file of files) {
          await this.delay(); // Rate limiting

          if (!file.id || !file.name) continue;

          const isFolder =
            file.mimeType === "application/vnd.google-apps.folder";

          if (isFolder) {
            this.stats.foldersScanned++;

            // Detect category type and create/get category
            const categoryType = this.detectCategoryType(file.name);
            const categoryId = await this.ensureCategory(
              file.name,
              categoryType
            );

            log.info(`${indent}[FOLDER] ${file.name}`, {
              categoryType,
              categoryId,
            });

            // Update context based on category type
            const updatedContext: SyncContext = { ...context };

            switch (categoryType) {
              case CategoryType.STREAM:
                updatedContext.streamId = categoryId;
                break;
              case CategoryType.GRADE:
                updatedContext.gradeId = categoryId;
                break;
              case CategoryType.SUBJECT:
                updatedContext.subjectId = categoryId;
                break;
              case CategoryType.LESSON:
                updatedContext.lessonId = categoryId;
                break;
              case CategoryType.MEDIUM:
                updatedContext.mediumId = categoryId;
                break;
              case CategoryType.RESOURCE_TYPE:
                updatedContext.resourceTypeId = categoryId;
                break;
            }

            // Recurse into subfolder
            await this.crawlFolder(file.id, updatedContext, depth + 1);
          } else {
            // It's a file - check if it should be imported
            const exists = await this.fileExists(file.id);

            if (exists) {
              log.debug(`${indent}[SKIP] File already exists: ${file.name}`);
              this.stats.filesSkipped++;
              continue;
            }

            // Determine MIME type
            const mimeType = file.mimeType || "application/octet-stream";

            // Create Resource record
            try {
              const resource = await prisma.resource.create({
                data: {
                  title: file.name,
                  description: `Synced from Drive on ${new Date().toISOString()}`,
                  driveFileId: file.id,
                  mimeType,
                  fileSize: file.size ? BigInt(file.size) : null,
                  uploaderId: "system-sync", // Special system user ID
                  status: "APPROVED", // Auto-approve synced resources
                  categories: {
                    connect: [
                      ...(context.streamId ? [{ id: context.streamId }] : []),
                      ...(context.gradeId ? [{ id: context.gradeId }] : []),
                      ...(context.subjectId ? [{ id: context.subjectId }] : []),
                      ...(context.lessonId ? [{ id: context.lessonId }] : []),
                      ...(context.mediumId ? [{ id: context.mediumId }] : []),
                      ...(context.resourceTypeId
                        ? [{ id: context.resourceTypeId }]
                        : []),
                    ],
                  },
                  // Synced resources don't require storage node (they're on Google Drive)
                },
              });

              log.info(`${indent}[NEW] Imported: ${file.name}`, {
                resourceId: resource.id,
                driveFileId: file.id,
                fileSize: file.size,
              });

              this.stats.filesImported++;
            } catch (error) {
              if (error instanceof Error) {
                log.error(
                  `${indent}[ERROR] Failed to import ${file.name}: ${error.message}`
                );
              } else {
                log.error(
                  `${indent}[ERROR] Failed to import ${file.name}`,
                  error
                );
              }
              this.stats.errorsEncountered++;
            }
          }
        }

        // Handle pagination
        pageToken = response.data.nextPageToken || undefined;
        hasMore = !!pageToken;
      }
    } catch (error) {
      log.error("Error crawling folder", error as Error);
      this.stats.errorsEncountered++;
      throw error;
    }
  }

  /**
   * Start the sync process
   */
  async sync(): Promise<void> {
    try {
      log.info("🚀 Starting Drive-to-DB sync...");

      if (!env.ROOT_FOLDER_ID) {
        throw new Error("ROOT_FOLDER_ID not configured. Cannot start sync.");
      }

      log.info(`Using ROOT_FOLDER_ID: ${env.ROOT_FOLDER_ID}`);

      // Ensure system sync user exists to satisfy foreign key constraint
      log.info("Ensuring system sync user exists...");
      await prisma.user.upsert({
        where: { id: "system-sync" },
        update: {}, // Don't update if exists
        create: {
          id: "system-sync",
          email: "system-sync@resilientlearn.com",
          name: "System Bot",
          role: "ADMIN",
          isOnboarded: true,
        },
      });
      log.info("System sync user ready.");

      // Start recursive crawl from root
      await this.crawlFolder(env.ROOT_FOLDER_ID, {});

      this.stats.endTime = new Date();

      // Print summary
      this.printSummary();
    } catch (error) {
      this.stats.endTime = new Date();
      if (error instanceof Error) {
        log.error(`Sync failed: ${error.message}`);
      } else {
        log.error("Sync failed with unknown error");
      }
      this.stats.errorsEncountered++;
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Print sync statistics
   */
  private printSummary(): void {
    const duration =
      this.stats.endTime && this.stats.startTime
        ? this.stats.endTime.getTime() - this.stats.startTime.getTime()
        : 0;

    console.log("\n");
    console.log("╔════════════════════════════════════════╗");
    console.log("║      Drive Sync Complete - Summary      ║");
    console.log("╚════════════════════════════════════════╝");
    console.log(`\n📊 Statistics:`);
    console.log(`  ├─ Folders Scanned: ${this.stats.foldersScanned}`);
    console.log(`  ├─ Files Processed: ${this.stats.filesProcessed}`);
    console.log(`  ├─ Files Imported: ${this.stats.filesImported}`);
    console.log(`  ├─ Files Skipped: ${this.stats.filesSkipped}`);
    console.log(`  ├─ Categories Created: ${this.stats.categoriesCreated}`);
    console.log(`  ├─ Errors: ${this.stats.errorsEncountered}`);
    console.log(`  └─ Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log("\n");
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    const sync = new DriveSync();
    await sync.sync();
    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      log.error("Sync script failed", error);
      console.error("\n❌ Error Details:");
      console.error(`Message: ${error.message}`);
      if (error.stack) {
        console.error(`Stack: ${error.stack}`);
      }
    } else {
      console.error("\n❌ Unknown error:", error);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}

export { DriveSync };
