import { Elysia } from "elysia";
import { announcementService } from "../services/announcement.service";
import { successResponse } from "../utils/response";

export const announcementController = new Elysia().get(
  "/",
  async () => {
    const announcements = await announcementService.getAnnouncements();
    return successResponse(announcements, "Announcements fetched successfully");
  },
  {
    detail: {
      tags: ["Announcement"],
    },
  }
);
