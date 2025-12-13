
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { log } from "../utils/logger";
import { Readable } from "stream";

// Define Hierarchy Context for Admin Uploads
export interface HierarchyTags {
  level?: { id: string; name: string };
  stream?: { id: string; name: string };
  grade?: { id: string; name: string };
  subject?: { id: string; name: string };
  lesson?: { id: string; name: string };
}

class DriveService {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive;
  private folderPathCache = new Map<string, string>(); // Cache path -> folderId

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
  }

  private async ensureTokenValid(): Promise<void> {
    const credentials = this.oauth2Client.credentials;
    if (!credentials.expiry_date || credentials.expiry_date < Date.now()) {
      const response = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(response.credentials);
    }
  }

  /**
   * Upload a file to Google Drive
   */
  async uploadFile(
    fileStream: Readable,
    fileName: string,
    folderId: string,
    mimeType: string
  ): Promise<{ id: string; webViewLink?: string }> {
    await this.ensureTokenValid();

    try {
      const response = await this.drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
        },
        media: {
          mimeType,
          body: fileStream,
        },
        fields: "id, webViewLink",
      });

      if (!response.data.id) {
        throw new Error("Failed to upload file to Drive");
      }

      return {
        id: response.data.id,
        webViewLink: response.data.webViewLink || undefined,
      };
    } catch (error) {
      log.error("Drive Upload Error", error as Error);
      throw error;
    }
  }

  /**
   * Get file stream for download/playback
   */
  async getStream(fileId: string, range?: string) {
    await this.ensureTokenValid();

    // Get metadata for size/type
    const meta = await this.drive.files.get({
      fileId,
      fields: "size, mimeType",
    });

    const headers: any = {};
    if (range) headers.Range = range;

    const stream = await this.drive.files.get(
      {
        fileId,
        alt: "media",
      },
      {
        responseType: "stream",
        headers,
      }
    );

    return {
      stream: stream.data,
      contentType: meta.data.mimeType || "application/octet-stream",
      contentLength: meta.data.size ? Number(meta.data.size) : undefined,
    };
  }

  /**
   * Ensure Canonical Folder Structure Exists (Level -> Stream -> Grade -> ...)
   */
  async ensureCanonicalFolder(hierarchy: HierarchyTags): Promise<string> {
    await this.ensureTokenValid();

    const rootId = env.UPLOAD_FOLDER_ID;
    if (!rootId) throw new Error("UPLOAD_FOLDER_ID not configured");

    // Order: Level -> Stream -> Grade -> Subject -> Lesson
    const nodes: { name: string }[] = [];
    if (hierarchy.level) nodes.push(hierarchy.level);
    if (hierarchy.stream) nodes.push(hierarchy.stream);
    if (hierarchy.grade) nodes.push(hierarchy.grade);
    if (hierarchy.subject) nodes.push(hierarchy.subject);
    if (hierarchy.lesson) nodes.push(hierarchy.lesson);

    if (nodes.length === 0) return rootId;

    let currentParentId = rootId;
    let pathString = "";

    for (const node of nodes) {
      pathString += `/${node.name}`;

      // Check Cache
      if (this.folderPathCache.has(pathString)) {
        currentParentId = this.folderPathCache.get(pathString)!;
        continue;
      }

      // Check Drive
      const q = `'${currentParentId}' in parents and name = '${node.name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const res = await this.drive.files.list({ q, fields: "files(id)" });

      if (res.data.files && res.data.files.length > 0) {
        currentParentId = res.data.files[0].id!;
      } else {
        // Create
        const createRes = await this.drive.files.create({
          requestBody: {
            name: node.name,
            mimeType: "application/vnd.google-apps.folder",
            parents: [currentParentId],
          },
          fields: "id",
        });
        currentParentId = createRes.data.id!;
      }

      this.folderPathCache.set(pathString, currentParentId);
    }

    return currentParentId;
  }

  /**
   * Ensure STORE folder exists for User Uploads
   */
  async ensureStoreFolder(): Promise<string> {
    await this.ensureTokenValid();
    const rootId = env.UPLOAD_FOLDER_ID;
    if (!rootId) throw new Error("UPLOAD_FOLDER_ID not configured");

    const storeName = "STORE";
    const cacheKey = `/STORE`;

    if (this.folderPathCache.has(cacheKey)) {
      return this.folderPathCache.get(cacheKey)!;
    }

    // Check Drive
    const q = `'${rootId}' in parents and name = '${storeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await this.drive.files.list({ q, fields: "files(id)" });

    let storeId: string;
    if (res.data.files && res.data.files.length > 0) {
      storeId = res.data.files[0].id!;
    } else {
      const createRes = await this.drive.files.create({
        requestBody: {
          name: storeName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [rootId],
        },
        fields: "id",
      });
      storeId = createRes.data.id!;
    }

    this.folderPathCache.set(cacheKey, storeId);
    return storeId;
  }
}

export const driveService = new DriveService();
