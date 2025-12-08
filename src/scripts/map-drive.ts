
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { log } from "../utils/logger";
import * as fs from "fs";
import * as path from "path";

class DriveMapper {
  private oauth2Client: OAuth2Client;
  private drive: drive_v3.Drive;
  private outputFile: string;
  private folderCount = 0;

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

    this.outputFile = path.join(process.cwd(), "drive.txt");
  }

  private async ensureTokenValid(): Promise<void> {
    const credentials = this.oauth2Client.credentials;
    if (!credentials.expiry_date || credentials.expiry_date < Date.now()) {
      const response = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(response.credentials);
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logToFile(message: string) {
    fs.appendFileSync(this.outputFile, message + "\n");
  }

  private async processFolder(folderId: string, depth: number = 0): Promise<void> {
    await this.ensureTokenValid();
    await this.delay(100); // Gentle rate limiting

    const indent = "  ".repeat(depth);
    
    try {
      let pageToken: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const response = await this.drive.files.list({
          q: `'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`,
          spaces: "drive",
          fields: "nextPageToken, files(id, name)",
          pageSize: 100,
          pageToken,
          orderBy: "name",
        });

        const folders = response.data.files || [];

        for (const folder of folders) {
          if (!folder.name) continue;

          this.folderCount++;
          const line = `${indent}📂 ${folder.name}`;
          console.log(line);
          this.logToFile(line);

          // Recurse
          if (folder.id) {
            await this.processFolder(folder.id, depth + 1);
          }
        }

        pageToken = response.data.nextPageToken || undefined;
        hasMore = !!pageToken;
      }
    } catch (error) {
      log.error(`Error scanning folder ${folderId}`, error as Error);
      this.logToFile(`${indent}❌ Error scanning ${folderId}`);
    }
  }

  public async map() {
    console.log("🚀 Starting Drive Mapping...");
    
    // Clear existing file
    fs.writeFileSync(this.outputFile, `Drive Structure Map - ${new Date().toISOString()}\n\n`);

    if (!env.ROOT_FOLDER_ID) {
      throw new Error("ROOT_FOLDER_ID not defined");
    }

    // Get Root Name
    const root = await this.drive.files.get({ fileId: env.ROOT_FOLDER_ID });
    const rootName = root.data.name || "ROOT";
    
    this.logToFile(`📂 ${rootName} (ROOT)`);
    console.log(`📂 ${rootName} (ROOT)`);

    await this.processFolder(env.ROOT_FOLDER_ID, 1);

    console.log(`\n✅ Mapping Complete! Scanned ${this.folderCount} folders.`);
    console.log(`📄 Output saved to: ${this.outputFile}`);
  }
}

if (import.meta.main) {
  new DriveMapper().map();
}
