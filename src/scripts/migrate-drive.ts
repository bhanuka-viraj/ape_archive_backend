import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env"; // Ensure this path matches your project
import { log } from "../utils/logger"; // Ensure this path matches your project

const prisma = new PrismaClient();

interface MigrationStats {
  foldersScanned: number;
  filesProcessed: number;
  filesMigrated: number;
  filesSkipped: number;
  tagsCreated: number;
  errorsEncountered: number;
  startTime: Date;
  endTime?: Date;
}

class DriveMigration {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive;
  private stats: MigrationStats;
  private readonly API_DELAY_MS = 150; // Slightly increased delay for safety
  private storageNodeId: number = 1; // Default storage node

  constructor() {
    this.oauth2Client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET
    );

    // Will be set from storage node in migrate() method
    this.drive = google.drive({
      version: "v3",
      auth: this.oauth2Client,
    });

    this.stats = {
      foldersScanned: 0,
      filesProcessed: 0,
      filesMigrated: 0,
      filesSkipped: 0,
      tagsCreated: 0,
      errorsEncountered: 0,
      startTime: new Date(),
    };
  }

  // --- HELPER: Auth ---
  private async ensureTokenValid(): Promise<void> {
    try {
      const credentials = this.oauth2Client.credentials;
      if (!credentials.expiry_date || credentials.expiry_date < Date.now()) {
        log.debug("Refreshing OAuth2 token for migration");
        const response = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(response.credentials);
      }
    } catch (error) {
      log.error("Failed to refresh token", error as Error);
      throw error;
    }
  }

  // --- HELPER: Rate Limit ---
  private async delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.API_DELAY_MS));
  }

  // --- CORE LOGIC: Tag Group Detection ---
  private detectTagGroup(folderName: string): string {
    const name = folderName.toLowerCase().trim();

    // 1. STREAM (Commerce Stream, Science Stream)
    // Matches: "Commerce Stream", "Art Stream"
    if (
      /(stream|science|commerce|arts|tech)/i.test(name) &&
      /stream/i.test(name)
    ) {
      return "Stream";
    }

    // 2. RESOURCE TYPE (Syllabus, Guides, Notes)
    // Matches: "Teacher's Guide", "Teachers Guide", "Teracher's Guide", "Syllabus", "Past Papers"
    // Note: The '.*' allows for typos or 's
    if (
      /^(syllabus|teacher.*guide|past\s*papers?|model\s*papers?|notes?|short\s*notes?|tute|ගුරු\s*මාර්ගෝපදේශ|පාඩම්\s*මාලාව)$/i.test(
        name
      )
    ) {
      return "ResourceType";
    }

    // 3. GRADE (Grade 12, Grade 13)
    if (/^grade\s*\d+/i.test(name)) {
      return "Grade";
    }

    // 4. MEDIUM (English Medium, Sinhala Medium)
    // STRICT CHECK: Must contain the word "Medium" to avoid confusing "English" subject
    if (/medium/i.test(name)) {
      return "Medium";
    }

    // 5. LESSON / UNIT (Unit 01, 01 - Title, 10.Title)
    // Matches: "Unit 1", "Lesson 5", "05 - ...", "10. ..."
    if (
      /^(unit|lesson|chapter|module|section|part)(\s+\d+)?|^\d+[\.\-\—\s].*$/i.test(
        name
      )
    ) {
      return "Lesson";
    }

    // 6. DEFAULT: Everything else is a SUBJECT
    // Matches: "English", "Accounting", "Biology", "O/L Subjects"
    return "Subject";
  }

  // --- CORE LOGIC: Tag Management ---
  private async ensureTag(
    name: string,
    group?: string
  ): Promise<{ id: string; created: boolean }> {
    try {
      // Clean up name (e.g. "English Medium" -> "English Medium")
      // We do NOT slugify the name field anymore, we keep it human readable
      const cleanName = name.trim();

      // Generate slug for unique constraint
      const slug = cleanName
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]/g, "");

      // Check existence by NAME (ignoring group for now to avoid duplicates like Math-Subject and Math-Lesson)
      // Ideally, a name should be unique.
      const existing = await prisma.tag.findFirst({
        where: { name: cleanName },
      });

      if (existing) {
        return { id: existing.id, created: false };
      }

      // Create new tag marked as SYSTEM (migrated)
      const tag = await prisma.tag.create({
        data: {
          name: cleanName,
          slug: slug,
          group: group || "User",
          source: "SYSTEM", // Mark as system-generated tag
        },
      });

      this.stats.tagsCreated++;
      log.debug(`Created Tag: [${tag.group}] ${tag.name}`);
      return { id: tag.id, created: true };
    } catch (error) {
      // Handle race condition where tag might be created by another async call
      const existing = await prisma.tag.findFirst({
        where: { name: name.trim() },
      });
      if (existing) return { id: existing.id, created: false };

      if (error instanceof Error) {
        log.error(`Error creating tag "${name}": ${error.message}`);
        if (error.stack) log.debug(`Stack: ${error.stack}`);
      } else {
        log.error(`Error creating tag "${name}"`, error);
      }
      this.stats.errorsEncountered++;
      throw error;
    }
  }

  // --- CORE LOGIC: Drive Copy ---
  private async copyFileToUploadFolder(
    fileId: string,
    fileName: string
  ): Promise<string | null> {
    try {
      await this.delay();

      // Validate UPLOAD_FOLDER_ID exists
      if (!env.UPLOAD_FOLDER_ID) {
        log.error(
          `UPLOAD_FOLDER_ID not configured - cannot copy file ${fileId}`
        );
        return null;
      }

      // Copy the file to UPLOAD_FOLDER_ID using the copy method
      // This creates an actual duplicate of the file
      const result = await this.drive.files.copy({
        fileId,
        requestBody: {
          name: fileName, // Keep original name
          parents: [env.UPLOAD_FOLDER_ID], // Place in upload folder
        },
        supportsAllDrives: true,
        fields: "id, name, parents",
      });

      const copiedFileId = result.data.id;
      log.debug(`File copied: ${fileId} → ${copiedFileId} (${fileName})`);
      return copiedFileId || null;
    } catch (error) {
      if (error instanceof Error) {
        log.error(`Drive Copy Failed for ${fileId}: ${error.message}`);
        if (error.stack) log.debug(`Stack: ${error.stack}`);
      } else {
        log.error(`Drive Copy Failed for ${fileId}`, error);
      }
      return null;
    }
  }

  // --- MAIN RECURSIVE CRAWLER ---
  private async processFolder(
    folderId: string,
    tagIds: string[] = [], // Accumulate tags as we go down
    depth: number = 0
  ): Promise<void> {
    await this.ensureTokenValid();
    await this.delay();

    const indent = "  ".repeat(depth);
    log.debug(`${indent}Scanning: ${folderId}`);

    try {
      let pageToken: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const response = await this.drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          spaces: "drive",
          fields: "nextPageToken, files(id, name, mimeType, size)",
          pageSize: 100, // Process in batches
          pageToken,
        });

        const files = response.data.files || [];
        this.stats.filesProcessed += files.length;

        for (const file of files) {
          await this.delay();
          if (!file.id || !file.name) continue;

          const isFolder =
            file.mimeType === "application/vnd.google-apps.folder";

          if (isFolder) {
            this.stats.foldersScanned++;

            // 1. Detect what this folder represents (Subject? Grade? Lesson?)
            const tagGroup = this.detectTagGroup(file.name);

            // 2. Create the Tag in DB
            const { id: tagId } = await this.ensureTag(file.name, tagGroup);

            log.info(`${indent}📁 [${tagGroup}] ${file.name}`);

            // 3. Add to backpack and dive deeper
            // We pass the NEW tagId along with all previous tagIds
            await this.processFolder(file.id, [...tagIds, tagId], depth + 1);
          } else {
            // It is a File (PDF, MP4, etc.)

            // 1. Copy file to UPLOAD_FOLDER first and get the new file ID
            const copiedFileId = await this.copyFileToUploadFolder(
              file.id,
              file.name
            );

            if (!copiedFileId) {
              log.error(`${indent}❌ Failed to Copy: ${file.name}`);
              this.stats.errorsEncountered++;
              continue;
            }

            // 2. Check if we already imported this file (by copied file ID in upload folder)
            const existingResource = await prisma.resource.findFirst({
              where: { driveFileId: copiedFileId },
            });

            if (existingResource) {
              log.debug(
                `${indent}⏭️  Skipped (Already migrated): ${file.name}`
              );
              this.stats.filesSkipped++;
              continue;
            }

            // 3. Create Resource in DB with the COPIED file ID
            const resource = await prisma.resource.create({
              data: {
                title: file.name,
                description: "Imported via Migration Script",
                driveFileId: copiedFileId, // Store the COPIED file ID, not the original
                mimeType: file.mimeType || "application/octet-stream",
                fileSize: file.size ? BigInt(file.size) : null,
                status: "APPROVED", // Auto-approve legacy files
                source: "SYSTEM", // Mark as system/migrated resource
                uploaderId: "system-sync", // Ensure this user exists!

                // Connect ALL collected tags
                tags: {
                  connect: tagIds.map((id) => ({ id })),
                },

                // Connect to Default Storage Node (ID 1)
                storageNodeId: 1,
              },
            });

            log.info(
              `${indent}✅ Migrated: ${file.name} (Tags: ${tagIds.length})`
            );
            this.stats.filesMigrated++;
          }
        }

        pageToken = response.data.nextPageToken || undefined;
        hasMore = !!pageToken;
      }
    } catch (error) {
      if (error instanceof Error) {
        log.error(`Error processing folder ${folderId}: ${error.message}`);
        if (error.stack) log.debug(`Stack: ${error.stack}`);
      } else {
        log.error(`Error processing folder ${folderId}`, error);
      }
      this.stats.errorsEncountered++;
    }
  }

  // --- ENTRY POINT ---
  async migrate(): Promise<void> {
    try {
      log.info("🚀 Starting Drive Migration...");

      // 1. Load credentials from Storage Node (Default ID=1)
      const storageNode = await prisma.storageNode.findUnique({
        where: { id: this.storageNodeId },
      });

      if (!storageNode) {
        throw new Error(
          `❌ Storage Node with ID ${this.storageNodeId} not found in database. Run "bun run seed" first.`
        );
      }

      if (!storageNode.refreshToken) {
        throw new Error(
          `❌ Storage Node has no refresh token. Re-run "bun run seed" to configure Google credentials.`
        );
      }

      log.info(
        `📦 Using Storage Node: ${storageNode.name} (${storageNode.email})`
      );

      // Set credentials from storage node
      this.oauth2Client.setCredentials({
        refresh_token: storageNode.refreshToken,
      });

      // Validate required environment variables (folders only)
      if (!env.ROOT_FOLDER_ID) {
        throw new Error("❌ ROOT_FOLDER_ID not configured in .env");
      }
      if (!env.UPLOAD_FOLDER_ID) {
        throw new Error("❌ UPLOAD_FOLDER_ID not configured in .env");
      }

      log.info(`Source Root: ${env.ROOT_FOLDER_ID}`);
      log.info(`Target Flat: ${env.UPLOAD_FOLDER_ID}`);

      // 2. Verify folders exist in Drive
      try {
        const rootFolder = await this.drive.files.get({
          fileId: env.ROOT_FOLDER_ID,
          fields: "id, name, mimeType",
        });
        log.info(`✓ Verified ROOT folder: "${rootFolder.data.name}"`);
      } catch (e) {
        throw new Error(
          `Cannot access ROOT_FOLDER_ID ${env.ROOT_FOLDER_ID}. Check permissions or ID.`
        );
      }

      try {
        const uploadFolder = await this.drive.files.get({
          fileId: env.UPLOAD_FOLDER_ID,
          fields: "id, name, mimeType",
        });
        log.info(`✓ Verified UPLOAD folder: "${uploadFolder.data.name}"`);
      } catch (e) {
        throw new Error(
          `Cannot access UPLOAD_FOLDER_ID ${env.UPLOAD_FOLDER_ID}. Check permissions or ID.`
        );
      }

      // 3. Ensure System User Exists
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

      // 4. Start Recursion
      await this.processFolder(env.ROOT_FOLDER_ID);

      // 5. Finish
      this.stats.endTime = new Date();
      this.printSummary();
    } catch (error) {
      log.error("Fatal Migration Error", error as Error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  }

  private printSummary() {
    const duration =
      (new Date().getTime() - this.stats.startTime.getTime()) / 1000;
    console.log(`
    ========================================
    🏁 MIGRATION COMPLETE
    ========================================
    📂 Folders Scanned: ${this.stats.foldersScanned}
    📄 Files Found:     ${this.stats.filesProcessed}
    ✅ Files Migrated:  ${this.stats.filesMigrated}
    ⏭️  Files Skipped:   ${this.stats.filesSkipped}
    🏷️  Tags Created:    ${this.stats.tagsCreated}
    ❌ Errors:          ${this.stats.errorsEncountered}
    ⏱️  Time Taken:      ${duration}s
    ========================================
    `);
  }
}

// Execute
if (import.meta.main) {
  new DriveMigration().migrate();
}
