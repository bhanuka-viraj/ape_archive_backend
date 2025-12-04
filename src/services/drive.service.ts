import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { log } from "../utils/logger";
import { AppError } from "../utils/error";
import { Readable } from "stream";

/**
 * Interface for Google Drive API responses
 */
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  size?: string;
  createdTime?: string;
}

interface FolderCacheEntry {
  id: string;
  timestamp: number;
}

/**
 * Drive Service - Manages Google Drive operations with folder hierarchy support
 */
class DriveService {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive;
  private folderCache: Map<string, FolderCacheEntry> = new Map();
  private readonly CACHE_TTL = 3600000; // 1 hour in ms
  private readonly FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

  constructor() {
    // Initialize OAuth2 Client
    this.oauth2Client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET
    );

    // Set credentials with refresh token
    if (env.GOOGLE_REFRESH_TOKEN) {
      this.oauth2Client.setCredentials({
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
      });
    }

    // Initialize Drive API
    this.drive = google.drive({
      version: "v3",
      auth: this.oauth2Client,
    });
  }

  /**
   * Ensure OAuth2 token is fresh by refreshing if needed
   */
  private async ensureTokenValid(): Promise<void> {
    try {
      const credentials = this.oauth2Client.credentials;
      if (!credentials.expiry_date || credentials.expiry_date < Date.now()) {
        log.debug("Refreshing OAuth2 token");
        const response = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(response.credentials);
      }
    } catch (error) {
      log.error("Failed to refresh token", error as Error);
      throw new AppError("Google authentication failed", 401);
    }
  }
  /**
   * Get or create a folder by name within a parent folder
   * Returns folder ID
   */
  private async ensureFolder(
    parentId: string,
    folderName: string
  ): Promise<string> {
    await this.ensureTokenValid();

    // Check cache first
    const cacheKey = `${parentId}/${folderName}`;
    const cached = this.folderCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      log.debug("Using cached folder", { cacheKey });
      return cached.id;
    }

    try {
      // Search for existing folder
      const response = await this.drive.files.list({
        q: `'${parentId}' in parents and name='${folderName}' and mimeType='${this.FOLDER_MIME_TYPE}' and trashed=false`,
        spaces: "drive",
        fields: "files(id, name)",
        pageSize: 1,
      });

      let folderId: string;

      if (response.data.files && response.data.files.length > 0) {
        folderId = response.data.files[0].id!;
        log.debug("Found existing folder", { folderName, folderId });
      } else {
        // Create folder if not found
        const createResponse = await this.drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: this.FOLDER_MIME_TYPE,
            parents: [parentId],
          },
          fields: "id",
        });

        folderId = createResponse.data.id!;
        log.info("Created new folder", { folderName, folderId });
      }

      // Cache the result
      this.folderCache.set(cacheKey, {
        id: folderId,
        timestamp: Date.now(),
      });

      return folderId;
    } catch (error) {
      log.error("Error ensuring folder", error as Error);
      throw new AppError(`Failed to manage folder: ${folderName}`, 500);
    }
  }

  /**
   * Ensure the complete folder hierarchy exists
   * Segments: [grade, subject, lesson, medium]
   * Returns the final parent folder ID
   */
  async ensureFolderHierarchy(segments: string[]): Promise<string> {
    await this.ensureTokenValid();

    if (!env.ROOT_FOLDER_ID) {
      throw new AppError("ROOT_FOLDER_ID not configured", 500);
    }

    let parentId = env.ROOT_FOLDER_ID;

    for (const segment of segments) {
      if (!segment || segment.trim().length === 0) {
        continue;
      }
      parentId = await this.ensureFolder(parentId, segment.trim());
    }

    return parentId;
  }

  /**
   * Upload a file stream to Google Drive
   * Returns file metadata
   */
  async uploadFile(
    fileStream: Readable,
    fileName: string,
    parentId: string,
    mimeType: string = "application/octet-stream"
  ): Promise<DriveFile> {
    await this.ensureTokenValid();

    try {
      const response = await this.drive.files.create({
        requestBody: {
          name: fileName,
          parents: [parentId],
          mimeType,
        },
        media: {
          mimeType,
          body: fileStream,
        },
        fields: "id, name, mimeType, webViewLink, size, createdTime",
      });

      const file = response.data as DriveFile;
      log.info("File uploaded successfully", {
        fileName,
        fileId: file.id,
        size: file.size,
      });

      return file;
    } catch (error) {
      log.error("File upload failed", error as Error);
      throw new AppError("Failed to upload file to Google Drive", 500);
    }
  }

  /**
   * Get file metadata from Google Drive
   */
  async getFileMetadata(fileId: string): Promise<DriveFile> {
    await this.ensureTokenValid();

    try {
      const response = await this.drive.files.get({
        fileId,
        fields: "id, name, mimeType, webViewLink, size, createdTime",
      });

      return response.data as DriveFile;
    } catch (error) {
      log.error("Failed to get file metadata", error as Error);
      throw new AppError("File not found", 404);
    }
  }

  /**
   * Get a readable stream for a file with Range header support
   * Supports partial content downloads
   */
  async getStream(
    fileId: string,
    range?: string
  ): Promise<{
    stream: Readable;
    contentType: string;
    contentLength?: string;
  }> {
    await this.ensureTokenValid();

    try {
      const metadata = await this.getFileMetadata(fileId);

      // Create request options
      const options: any = {
        fileId,
        alt: "media",
      };

      // Handle Range header for partial content
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : undefined;

        if (!isNaN(start)) {
          options.headers = {
            Range: `bytes=${start}${end ? `-${end}` : ""}`,
          };
        }
      }

      const response = await this.drive.files.get(options, {
        responseType: "stream",
      });

      log.debug("Stream created for file", { fileId });

      return {
        stream: response.data as Readable,
        contentType: metadata.mimeType || "application/octet-stream",
        contentLength: metadata.size,
      };
    } catch (error) {
      log.error("Failed to create stream", error as Error);
      throw new AppError("Failed to stream file from Google Drive", 500);
    }
  }

  /**
   * Delete a file from Google Drive
   */
  async deleteFile(fileId: string): Promise<void> {
    await this.ensureTokenValid();

    try {
      await this.drive.files.delete({
        fileId,
      });
      log.info("File deleted successfully", { fileId });
    } catch (error) {
      log.error("Failed to delete file", error as Error);
      throw new AppError("Failed to delete file from Google Drive", 500);
    }
  }

  /**
   * Clear the folder cache (useful for testing or manual refresh)
   */
  clearFolderCache(): void {
    this.folderCache.clear();
    log.debug("Folder cache cleared");
  }
}

// Export singleton instance
export const driveService = new DriveService();
