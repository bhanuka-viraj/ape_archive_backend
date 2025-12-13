
import fs from "fs";
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { log } from "../utils/logger";
import { TagPatterns } from "../utils/tag-patterns";

const prisma = new PrismaClient();

// Configuration
const ROOT_FOLDER_ID = process.env.ROOT_FOLDER_ID; // The Drive Folder ID to migrate
const UPLOAD_FOLDER_ID = process.env.UPLOAD_FOLDER_ID; // Destination in Drive (archive)
const SCOPES = ["https://www.googleapis.com/auth/drive"];

if (!ROOT_FOLDER_ID || !UPLOAD_FOLDER_ID) {
  log.error("Missing ROOT_FOLDER_ID or UPLOAD_FOLDER_ID in .env");
  process.exit(1);
}

// --- Auth Setup ---
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/oauth2callback"
);
auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth });

// --- Type Definitions ---
interface Stats {
  filesMigrated: number;
  filesSkipped: number;
  foldersScanned: number;
  errors: number;
  startTime: number;
}

interface HierarchyContext {
    levelName?: string;
    gradeName?: string;
    streamName?: string;
    
    isFlexibleRoot: boolean;
    flexibleTags: string[]; 
    parentTagId: string | null; 
    subject?: { id: string, name: string };
    lessonName?: string; // NEW: Lesson/Unit Support
    inheritedTags?: string[];
}

class DriveMigrator {
  private stats: Stats = {
    filesMigrated: 0,
    filesSkipped: 0,
    foldersScanned: 0,
    errors: 0,
    startTime: Date.now(),
  };

  private uniqueFileLog = new Set<string>(); // prevent processing same file twice in one run
  private folderPathCache = new Map<string, string>(); // Helper for ensuring folders

  async run() {
    log.info("🚀 Starting Smart Drive Migration (Grade-First Logic)...");
    log.info(`   (Duplicate Check Enabled via originalDriveId)`);

    const hasToken = !!process.env.GOOGLE_REFRESH_TOKEN;
    const tokenPreview = hasToken ? process.env.GOOGLE_REFRESH_TOKEN!.substring(0, 5) + "..." : "NONE";
    log.info(`   > Checking Token: ${hasToken ? 'PRESENT' : 'MISSING'} (${tokenPreview})`);

    // Seed System User
    log.info("   > Seeding System User... (Prisma Upsert)");
    try {
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
        log.info("   > System User Seeded.");
    } catch (dbErr) {
        log.error("   > DB Error seeding user", dbErr as Error);
        return; 
    }

    try {
      // Start at Root
      // Root context is empty
      const initialContext: HierarchyContext = { 
          isFlexibleRoot: false, 
          flexibleTags: [],
          parentTagId: null 
      };
      
      await this.processFolder(ROOT_FOLDER_ID!, initialContext, 0);
    } catch (e) {
      log.error("Migration Fatal Error", e as Error);
    }

    const duration = (Date.now() - this.stats.startTime) / 1000;
    log.info(`Migration Complete in ${duration}s`);
    log.info(`Files Migrated: ${this.stats.filesMigrated}`);
    log.info(`Files Skipped: ${this.stats.filesSkipped}`);
    log.info(`Errors: ${this.stats.errors}`);
  }

  // --- Core Recursive Function ---
  private async processFolder(folderId: string, context: HierarchyContext, depth: number) {
    this.stats.foldersScanned++;
    if (depth > 12) return; // Safety break

    let pageToken: string | undefined = undefined;

    do {
      try {
        log.info(`   > [API] Listing Folder: ${folderId}`);
        const res = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: "nextPageToken, files(id, name, mimeType)",
          pageToken,
          pageSize: 100, // Batch size
        });
        log.info(`   > [API] Success. Found ${res.data.files?.length || 0} files.`);

        const files = res.data.files || [];
        pageToken = res.data.nextPageToken || undefined;

        for (const file of files) {
          if (file.mimeType === "application/vnd.google-apps.folder") {
            // Recurse into Folder
            const newContext = await this.deriveFolderContext(file.name!, context);
            await this.processFolder(file.id!, newContext, depth + 1);
          } else {
            // Process File
            await this.migrateFile(file, context);
          }
        }
      } catch (err: any) {
        log.error(`Error listing folder ${folderId}: ${err.message}`);
        this.stats.errors++;
        if (err.code === 403) {
            log.warn("Rate Limit Hit. Waiting 5s...");
            await new Promise(r => setTimeout(r, 5000)); // Simple Backoff
        }
        break; 
      }
    } while (pageToken);
  }

  // --- Context Logic (The Brain) ---
  private async deriveFolderContext(folderName: string, parentContext: HierarchyContext): Promise<HierarchyContext> {
      const cleanName = folderName.trim();
      // Clone and init arrays if missing (safe clone)
      const newContext: HierarchyContext = { 
          ...parentContext,
          flexibleTags: [...(parentContext.flexibleTags || [])],
          inheritedTags: [...(parentContext.inheritedTags || [])]
      };
      
      // 1. Check Root Level Switch
      if (!parentContext.levelName && !parentContext.isFlexibleRoot) {
          // Explicit Mapping for Legacy Names
          let canonicalLevel = null;
          if (/^6\s*-\s*9\s*Class\s*Subjects/i.test(cleanName)) canonicalLevel = "Secondary";
          else if (/^Primary\s*Class\s*Subjects/i.test(cleanName)) canonicalLevel = "Primary";
          else if (/^A\/L\s*Subjects/i.test(cleanName)) canonicalLevel = "A/L";
          else if (/^O\/L\s*Subjects/i.test(cleanName)) canonicalLevel = "O/L";
          else {
              // DB Check
              const rootTag = await prisma.tag.findFirst({
                 where: { name: { equals: cleanName, mode: 'insensitive' }, parentId: null, group: "LEVEL" } 
              });
              if (rootTag) canonicalLevel = rootTag.name;
          }

          if (canonicalLevel) {
               newContext.levelName = canonicalLevel;
               const isSchool = ["A/L", "O/L", "Primary", "Secondary", "Scholarship"].some(k => canonicalLevel!.includes(k));
               newContext.isFlexibleRoot = !isSchool;
               
               if (newContext.isFlexibleRoot) {
                   const tag = await this.ensureTag(canonicalLevel, "LEVEL", null);
                   newContext.flexibleTags = [tag.id];
                   newContext.parentTagId = tag.id;
               } 
               log.info(`   [CTX] Root Switch: ${cleanName} -> ${canonicalLevel} (School: ${isSchool})`);
               return newContext;
          }
      }

      // 2. Flexible Mode
      if (newContext.isFlexibleRoot) {
          if (/attribute/i.test(cleanName)) return newContext; 
          
          const { categorizeFolder } = await import("../utils/tag-patterns");
          // Check if Attribute Folder
          const extraTags = await this.extractFileAttributes(cleanName);
          if (extraTags.length > 0) {
              // It is an attribute folder (or contains attributes).
              // We should flatten it but KEEP the tags.
              newContext.inheritedTags!.push(...extraTags);
              return newContext; 
          }

          const parentId = newContext.parentTagId; 
          const tag = await this.ensureTag(cleanName, "SUBJECT", parentId);
          newContext.flexibleTags.push(tag.id);
          newContext.parentTagId = tag.id; 
          return newContext;
      }

      // 3. Strict School Mode
      // A. Is it a Grade?
      if (/Grade \d+/i.test(cleanName)) {
           newContext.gradeName = cleanName;
           return newContext;
      }

      // B. Is it a Stream?
      if (/Stream/i.test(cleanName) || ["Science", "Maths", "Arts", "Commerce", "Bio", "Combined Maths", "Tech"].some(k => cleanName.toLowerCase().includes(k.toLowerCase()))) {
          newContext.streamName = cleanName;
          return newContext;
      }

      // C. Check Fallback / Attributes
      // We check if this folder name resolves to any Attribute Tags.
      const extraTags = await this.extractFileAttributes(cleanName);
      
      if (extraTags.length > 0) {
          // It IS an attribute folder (e.g. "English Medium" -> [TagID])
          // We add it to context, and skip strict path building.
          log.info(`   [CTX] Folder is Attribute: ${cleanName} -> Inheriting Tags`);
          newContext.inheritedTags!.push(...extraTags);
          return newContext;
      }
      
      const { categorizeFolder } = await import("../utils/tag-patterns");
      const match = categorizeFolder(cleanName);
      if (match && !match.isHierarchy) {
           log.info(`   [CTX] Ignoring Attribute Folder (Matched Pattern but no Tag Created?): ${cleanName}`);
           return newContext;
      }

      // D. Subject OR Lesson logic
      if (parentContext.subject) {
          // IF we already have a subject, this MUST be a Lesson (Unit)
          log.info(`   [CTX] Recognized Lesson/Unit: ${cleanName} (Parent Subject: ${parentContext.subject.name})`);
          newContext.lessonName = cleanName;
      } else {
          // Else it is a Subject
          log.info(`   [CTX] Recognized Subject: ${cleanName} (Parent: ${parentContext.gradeName || parentContext.streamName || parentContext.levelName || 'ROOT'})`);
          newContext.subject = { id: "TEMP", name: cleanName }; 
      }
      return newContext;
  }

  // --- 2.5 Ensure Physical Folder Structure ---
  private async ensureCanonicalFolder(context: HierarchyContext): Promise<string> {
      // Build correct path string: /A-L / Grade 12 / Science Stream / [Subject]
      const pathParts: string[] = [];
      
      if (context.levelName) pathParts.push(context.levelName);
      else if (context.isFlexibleRoot && context.flexibleTags.length > 0) {
          // For flexible roots, we might want "IELTS" -> "Listening"
          if (context.levelName) pathParts.push(context.levelName); // e.g. IELTS
          
          // Child folders? 
          if (context.subject) pathParts.push(context.subject.name);
      }
      
      if (context.gradeName) pathParts.push(context.gradeName);
      if (context.streamName) pathParts.push(context.streamName);
      if (context.subject) pathParts.push(context.subject.name);

      if (pathParts.length === 0) return UPLOAD_FOLDER_ID!;

      let currentParentId = UPLOAD_FOLDER_ID!;
      let fullPath = "";

      for (const part of pathParts) {
          fullPath += `/${part}`;
          if (this.folderPathCache.has(fullPath)) {
              currentParentId = this.folderPathCache.get(fullPath)!;
              continue;
          }

          // Check Drive
          // Sanitize name for Drive query
          const cleanPart = part.replace(/'/g, "\\'");
          try {
             const res = await drive.files.list({
               q: `'${currentParentId}' in parents and name = '${cleanPart}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
               fields: 'files(id)',
             });
             
             if (res.data.files && res.data.files.length > 0) {
                 currentParentId = res.data.files[0].id!;
             } else {
                 // Create
                 log.info(`   > [FOLDER] Creating: ${part}`);
                 const newFolder = await drive.files.create({
                     requestBody: {
                         name: part,
                         mimeType: 'application/vnd.google-apps.folder',
                         parents: [currentParentId]
                     },
                     fields: 'id'
                 });
                 currentParentId = newFolder.data.id!;
             }
             this.folderPathCache.set(fullPath, currentParentId);
          } catch (e) {
              log.error(`   > Folder Check Fail: ${part}`, e as Error);
              // Fallback to current parent if fail?
          }
      }
      return currentParentId;
  }

  private async migrateFile(file: drive_v3.Schema$File, context: HierarchyContext) {
      if (!file.id || !file.name) return;
      if (this.uniqueFileLog.has(file.id)) return;
      this.uniqueFileLog.add(file.id);

      log.info(`   [FILE] Found: ${file.name} (Type: ${file.mimeType})`);

      // --- 1. Deduplication Check ---
      const existing = await prisma.resource.findFirst({
          where: { originalDriveId: file.id }
      });
      
      if (existing) {
          log.info(`   [SKIP] Duplicate: ${file.name}`);
          this.stats.filesSkipped++;
          return;
      }

      // --- 2. Resolve Final Tag Chain ---
      const finalTagIds: string[] = [];
      
      // A. Inherited Attributes (from Flattened Folders)
      if (context.inheritedTags && context.inheritedTags.length > 0) {
          finalTagIds.push(...context.inheritedTags);
      }

      // (Simplified logic to reuse code - keeping existing tag logic unchanged essentially)
      if (context.isFlexibleRoot) {
          finalTagIds.push(...context.flexibleTags);
          const extra = await this.extractFileAttributes(file.name); 
          finalTagIds.push(...extra);
      } else {
          // Strict School Logic
          const levelTag = context.levelName 
            ? await prisma.tag.findFirst({ where: { name: { contains: context.levelName, mode: 'insensitive' }, group: "LEVEL" } })
            : null;
          if (levelTag) finalTagIds.push(levelTag.id);

          let gradeTag = null;
          if (context.gradeName && levelTag) {
             const gradeNum = context.gradeName.match(/\d+/)?.[0];
             if (gradeNum) {
                 gradeTag = await prisma.tag.findFirst({ 
                     where: { name: { contains: `Grade ${gradeNum}`, mode: 'insensitive' }, parentId: levelTag.id } 
                 });
             }
          }
          if (gradeTag) finalTagIds.push(gradeTag.id);

          let streamTag = null;
          if (context.streamName && gradeTag) {
              const cleanStream = context.streamName.replace(/Stream/i, "").trim();
              streamTag = await prisma.tag.findFirst({
                  where: { name: { contains: cleanStream, mode: 'insensitive' }, parentId: gradeTag.id }
              });
          }
          if (streamTag) finalTagIds.push(streamTag.id);
          
          let parentForSubject = streamTag ? streamTag.id : (gradeTag ? gradeTag.id : null);
          if (parentForSubject && context.subject) {
              if (!/attribute/i.test(context.subject.name)) {
                  const subjectTag = await this.ensureTag(context.subject.name, "SUBJECT", parentForSubject);
                  finalTagIds.push(subjectTag.id);
                  // parentForSubject = subjectTag.id; 
              }
          }
          // E. Lesson / Unit
          if (parentForSubject && context.lessonName) {
               const lessonTag = await this.ensureTag(context.lessonName, "LESSON", parentForSubject);
               finalTagIds.push(lessonTag.id);
          }

          const extra = await this.extractFileAttributes(file.name);
          finalTagIds.push(...extra);
      }
      
      if (finalTagIds.length === 0) {
          this.stats.filesSkipped++;
          return;
      }

      // --- 3. Copy File to Canonical Folder ---
      // Determine Target Folder
      const targetParentId = await this.ensureCanonicalFolder(context);

      try {
          if (this.stats.filesMigrated % 10 === 0) log.info(`Migrating... ${file.name}`);
          
          const newFile = await drive.files.copy({
              fileId: file.id!,
              requestBody: {
                  parents: [targetParentId], // NEW PARENT
                  name: file.name
              }
          });

          if (newFile.data.id) {
               await prisma.resource.create({
                   data: {
                       title: file.name!,
                       description: "Auto-migrated from Legacy Drive",
                       driveFileId: newFile.data.id,
                       originalDriveId: file.id!,
                       mimeType: file.mimeType,
                       source: "SYSTEM",
                       status: "APPROVED",
                       uploaderId: "system-sync",
                       storageNodeId: 1,
                       tags: {
                           connect: finalTagIds.map(id => ({ id }))
                       }
                   }
               });
               this.stats.filesMigrated++;
          }
      } catch (e: any) {
          log.error(`Failed to copy ${file.name}: ${e.message}`);
          this.stats.errors++;
           if (e.code === 403) {
            await new Promise(r => setTimeout(r, 2000));
        }
      }
  }

  // --- Helpers ---

  private async extractFileAttributes(fileName: string): Promise<string[]> {
      const extraTagIds: string[] = [];
      const { TagPatterns } = await import("../utils/tag-patterns");
      
      for (const p of TagPatterns) {
          if (p.isHierarchy) continue; // Only attributes
          if (p.pattern.test(fileName)) {
               const match = fileName.match(p.pattern);
               if (match) {
                   const matchedText = match[0];
                   const tag = await this.ensureTag(matchedText, p.group, null);
                   extraTagIds.push(tag.id);
               }
          }
      }
      return extraTagIds;
  }

  private async ensureTag(name: string, group: string, parentId: string | null) {
      // Find First or Create
      const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

      const existing = await prisma.tag.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, parentId }
      });
      if (existing) return existing;
      
      return await prisma.tag.create({
          data: { name: name.trim(), slug, group, parentId, source: "SYSTEM" }
      });
  }
}

// Helper to Run
if (import.meta.main) {
    const migrator = new DriveMigrator();
    migrator.run();
}
