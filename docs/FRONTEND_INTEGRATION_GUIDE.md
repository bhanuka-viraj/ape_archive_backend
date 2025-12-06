# APE Archive - Frontend Integration Flow

## Overview

The system has two main resource sources:

- **SYSTEM**: Migrated resources (library) + Admin-uploaded resources
- **USER**: User-uploaded resources (search)

Resources are organized by tags with groups (Grade, Subject, Lesson, Medium, ResourceType).

---

## Authentication

**Complete Auth Flow**: See [AUTH_FLOW.md](./AUTH_FLOW.md)

### Quick Reference - BFF Pattern (1 Step for Frontend)

1. **Login**: User clicks button → `window.location.href = '/api/v1/auth/google'`
2. **Backend Magic**: Backend handles all Google interactions internally
3. **Redirect**: Backend redirects to `/dashboard#accessToken=...`
4. **Extract**: Frontend extracts token from URL fragment
5. **Store**: Save token in localStorage
6. **Use**: Include `Authorization: Bearer <token>` in all authenticated requests
7. **Logout**: Clear localStorage

---

## Frontend Features & Endpoints

### 1. Library View (Hierarchical Browse)

Display migrated resources organized by tag hierarchy for easy navigation.

**Endpoint:**

```
GET /resources/library/hierarchy
```

**Response Format:**

```json
{
  "Grade 12": {
    "English": {
      "Unit 1": [
        {
          "id": "resource-id",
          "title": "Chapter Summary",
          "description": "...",
          "driveFileId": "...",
          "mimeType": "application/pdf",
          "views": 150,
          "downloads": 45,
          "tags": [
            { "id": "...", "name": "Grade 12", "group": "Grade" },
            { "id": "...", "name": "English", "group": "Subject" }
          ]
        }
      ],
      "Unit 2": [...]
    },
    "Mathematics": {...}
  },
  "Grade 13": {...}
}
```

**Features:**

- Nested dropdowns by group (Grade → Subject → Lesson → Medium → ResourceType)
- Click through hierarchy to browse resources
- Only shows SYSTEM resources (migrated + admin-uploaded)
- All resources in library are APPROVED

---

### 2. Get Library Tags (For Dropdown Filters)

Get available tags grouped by their group field for building dropdowns.

**Endpoint:**

```
GET /resources/library/tags
```

**Response Format:**

```json
{
  "Grade": [
    { "id": "tag-id-1", "name": "Grade 12" },
    { "id": "tag-id-2", "name": "Grade 13" }
  ],
  "Subject": [
    { "id": "tag-id-3", "name": "English" },
    { "id": "tag-id-4", "name": "Mathematics" }
  ],
  "Lesson": [
    { "id": "tag-id-5", "name": "Unit 1" },
    { "id": "tag-id-6", "name": "Unit 2" }
  ],
  "Medium": [
    { "id": "tag-id-7", "name": "English Medium" },
    { "id": "tag-id-8", "name": "Sinhala Medium" }
  ],
  "ResourceType": [
    { "id": "tag-id-9", "name": "Notes" },
    { "id": "tag-id-10", "name": "Past Papers" }
  ]
}
```

**Frontend Usage:**

```
1. Fetch available tags
2. Build dropdowns for each group
3. On selection, filter resources from hierarchy
```

---

### 3. Search Resources

Search both SYSTEM and USER resources (migrated + admin + user-uploaded).

**Endpoint:**

```
GET /resources?search=keyword&page=1&limit=10
```

**Query Parameters:**

- `search` (optional): Keyword search in title/description
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `status` (optional): Filter by status (PENDING, APPROVED, REJECTED)

**Response Format:**

```json
{
  "data": [
    {
      "id": "resource-id",
      "title": "Past Paper 2020",
      "description": "...",
      "driveFileId": "...",
      "mimeType": "application/pdf",
      "status": "APPROVED",
      "views": 200,
      "downloads": 50,
      "createdAt": "2025-12-01T10:00:00Z",
      "uploader": {
        "id": "user-id",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "tags": [
        { "id": "...", "name": "Grade 12", "group": "Grade" },
        { "id": "...", "name": "English", "group": "Subject" }
      ]
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 10,
    "totalPages": 15
  }
}
```

**Features:**

- Returns both SYSTEM and USER resources
- Search across all approved resources
- Pagination support

---

### 4. Get Single Resource Details

Get full resource details including file information.

**Endpoint:**

```
GET /resources/:id
```

**Response Format:**

```json
{
  "id": "resource-id",
  "title": "Resource Title",
  "description": "...",
  "driveFileId": "file-id-in-drive",
  "mimeType": "application/pdf",
  "fileSize": 1500000,
  "status": "APPROVED",
  "source": "SYSTEM",
  "views": 250,
  "downloads": 75,
  "createdAt": "2025-12-01T10:00:00Z",
  "uploader": {
    "id": "user-id",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "tags": [
    { "id": "...", "name": "Grade 12", "group": "Grade" },
    { "id": "...", "name": "English", "group": "Subject" }
  ]
}
```

---

### 5. Stream/Download Resource

Download resource file from Google Drive.

**Endpoint:**

```
GET /resources/:id/stream
```

**Headers (Optional):**

- `range`: For partial downloads (e.g., "bytes=0-999")

**Response:**

- File stream with appropriate Content-Type header
- Status 206 if range request
- Automatically increments download count

**Frontend Usage:**

```javascript
// Simple download
const link = document.createElement("a");
link.href = `/resources/${resourceId}/stream`;
link.download = "filename.pdf";
link.click();

// Or stream in iframe
window.open(`/resources/${resourceId}/stream`, "_blank");
```

---

### 6. Admin Upload Endpoint (For Admin Portal)

Upload resource directly to library (auto-approved, marked as SYSTEM).

**Endpoint:**

```
POST /resources/admin/upload
```

**Authentication:**

- Must be logged in as ADMIN role
- Returns 403 if user is not ADMIN

**Request Body (Form Data):**

```
- file: File object (required)
- tagIds: Array of tag IDs (required, minimum 1)
- title: String (optional, defaults to filename)
- description: String (optional)
```

**Response:**

```json
{
  "id": "resource-id",
  "title": "Admin Uploaded Resource",
  "description": "...",
  "driveFileId": "file-id-in-upload-folder",
  "mimeType": "application/pdf",
  "fileSize": 1500000,
  "status": "APPROVED",
  "source": "SYSTEM",
  "tags": [{ "id": "...", "name": "Grade 12", "group": "Grade" }],
  "createdAt": "2025-12-06T15:30:00Z"
}
```

**Frontend Usage (Admin Portal):**

```javascript
async function uploadAdminResource(file, tagIds, title, description) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("tagIds", JSON.stringify(tagIds));
  if (title) formData.append("title", title);
  if (description) formData.append("description", description);

  const response = await fetch("/resources/admin/upload", {
    method: "POST",
    body: formData,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.json();
}
```

---

## User Interface Flow

### Library Page

```
1. Load and display hierarchy structure
2. User navigates through dropdowns (Grade → Subject → Lesson → Medium)
3. Resources appear in the selected category
4. Click resource to view details
5. Click "Download" button to stream file
```

### Search Page

```
1. User enters search keyword
2. Display paginated results from both SYSTEM and USER resources
3. Filter by status if needed
4. Click resource to view details
5. Click "Download" button to stream file
```

### Admin Portal (New)

```
1. Admin navigates to upload section
2. Load available tags grouped by type
3. Admin selects file and required tags
4. Submit to /resources/admin/upload
5. Resource auto-approved and appears in library
```

---

## Tag System Architecture

### Tag Groups (Hierarchy Levels)

- **Grade**: Grade 12, Grade 13
- **Subject**: English, Mathematics, Science, etc.
- **Lesson**: Unit 1, Unit 2, Chapter 1, etc.
- **Medium**: English Medium, Sinhala Medium
- **ResourceType**: Notes, Past Papers, Model Papers, etc.

### Tag Sources

- **SYSTEM**: Migrated tags (from old folder hierarchy) + admin-created tags
- **USER**: Custom user-created tags

### Resource Sources

- **SYSTEM**: Migrated resources + admin-uploaded resources (appears in library)
- **USER**: User-uploaded resources (appears in search only)

---

## Key Implementation Notes

### For Library (Hierarchy View)

- Only fetch SYSTEM resources
- Group by tags in order: Grade → Subject → Lesson → Medium → ResourceType
- Response is nested object (not array)
- Build UI from nested structure

### For Search

- Fetch both SYSTEM and USER resources
- Response is paginated array
- Include uploader information
- Show resource source if needed

### For Admin Upload

- Check user role (must be ADMIN)
- Select tags from available SYSTEM tags only
- Auto-approve and mark as SYSTEM
- File stored in UPLOAD_FOLDER

### Backward Compatibility

- Old category endpoints still exist but deprecated
- New tag-based system is preferred for new features
- Migration script marked all migrated data as SYSTEM

---

## API Base URL

```
http://localhost:3000/api/v1/resources
```

All endpoints listed above are prefixed with this base URL.

---

## Status Codes

- `200`: Success
- `201`: Created
- `400`: Bad request
- `401`: Unauthorized
- `403`: Forbidden (not admin for admin endpoints)
- `404`: Not found
- `500`: Server error

---

## Error Response Format

```json
{
  "success": false,
  "message": "Error description",
  "statusCode": 400
}
```

---

## Success Response Format

```json
{
  "success": true,
  "data": {...},
  "message": "Operation successful"
}
```
