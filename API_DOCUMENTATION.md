# ResilientLearn - API Documentation

## Overview

ResilientLearn is a disaster relief education platform that acts as a central proxy for Google Drive resources. The system is built with Bun + ElysiaJS and uses PostgreSQL with Prisma ORM.

**Base URL**: `http://localhost:3000`

---

## Architecture & Flow

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Web/Mobile)                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    ResilientLearn API                         │
│  (Bun + ElysiaJS + PostgreSQL + Google Drive Integration)   │
└─────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────┬─────────────────────┐
        ↓                     ↓                     ↓
   PostgreSQL          Google Drive            OAuth2.0
    Database           (File Storage)          (Authentication)
```

### Data Flow for Resource Upload

```
1. User selects file + hierarchy (Grade, Subject, Lesson, Medium)
2. POST /resources/upload
   ├─ Validate request (JWT auth)
   ├─ Ensure folder hierarchy in Drive
   │  └─ [Grade] → [Subject] → [Lesson] → [Medium]
   ├─ Stream file to Drive
   ├─ Create/link categories in DB
   ├─ Create Resource record
   └─ Return resource metadata
3. Resource stored with driveFileId for later streaming
4. Users can GET /resources/:id/stream to download
```

### Data Flow for Forum

```
1. User creates question (POST /forum)
2. System creates slug and stores in DB
3. Other users post answers (POST /forum/:id/answers)
4. Answers sorted by:
   - Author role (TEACHER > STUDENT > GUEST)
   - Accepted flag
   - Upvote count
5. Users vote on answers (POST /forum/answers/:id/vote)
6. Question author marks best answer (PATCH /forum/:id/answers/:answerId/accept)
```

### Authentication Flow

```
1. User clicks "Google Login"
2. GET /auth/google → Frontend redirects to Google OAuth
3. User approves → Google redirects to callback with auth code
4. GET /auth/google/callback → Backend exchanges code for token
5. System creates/links user in DB
6. Backend issues JWT tokens (access + refresh)
7. Frontend stores tokens, uses access token in Authorization header
8. POST /auth/onboard → User selects role (STUDENT/TEACHER) and creates profile
```

---

## Authentication

All endpoints requiring authentication use **Bearer Token** (JWT) in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Token Structure

```json
{
  "id": "user-uuid",
  "role": "STUDENT|TEACHER|ADMIN|GUEST",
  "deviceId": "web",
  "iat": 1701681234,
  "exp": 1701684834
}
```

---

## API Endpoints

### Auth Endpoints

#### 1. Google Login/Signup

```http
POST /auth/google
Content-Type: application/json

{
  "idToken": "google_id_token_from_frontend"
}
```

**Response** (201):

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user-uuid",
      "email": "user@example.com",
      "name": "User Name",
      "role": "GUEST",
      "imageUrl": "https://...",
      "isOnboarded": false
    },
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc..."
  }
}
```

#### 2. Refresh Access Token

```http
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "existing_refresh_token"
}
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "accessToken": "new_access_token"
  }
}
```

#### 3. Get Current User

```http
GET /auth/me
Authorization: Bearer <access_token>
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "id": "user-uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "GUEST",
    "imageUrl": "https://...",
    "isOnboarded": false,
    "createdAt": "2025-12-04T..."
  }
}
```

#### 4. Onboard User

```http
POST /auth/onboard
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "role": "STUDENT",
  "school": "Royal College",
  "batch": "2025 A/L",
  "interests": ["combined-maths", "physics"]
}
```

Or for teachers:

```json
{
  "role": "TEACHER",
  "bio": "Passionate educator",
  "qualifications": "BSc Physics, MEd",
  "whatsappNumber": "+94701234567",
  "telegramUser": "@teacher_name",
  "subjects": ["physics", "combined-maths"]
}
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "id": "user-uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "STUDENT",
    "isOnboarded": true,
    "imageUrl": "https://..."
  }
}
```

---

### Resource Endpoints

#### 1. Upload Resource

```http
POST /resources/upload
Authorization: Bearer <access_token>
Content-Type: multipart/form-data

file: <file>
title: "Integration Techniques"
description: "Complete guide to integration"
grade: "A/L"
subject: "Combined Mathematics"
lesson: "Integration"
medium: "English"
```

**Response** (201):

```json
{
  "success": true,
  "data": {
    "id": "resource-uuid",
    "title": "Integration Techniques",
    "description": "Complete guide to integration",
    "driveFileId": "google_drive_file_id",
    "mimeType": "application/pdf",
    "fileSize": 2048576,
    "status": "PENDING",
    "views": 0,
    "downloads": 0,
    "categories": [
      { "id": 1, "name": "A/L", "slug": "a-l", "type": "GRADE" },
      {
        "id": 2,
        "name": "Combined Mathematics",
        "slug": "combined-mathematics",
        "type": "SUBJECT"
      },
      {
        "id": 3,
        "name": "Integration",
        "slug": "integration",
        "type": "LESSON"
      },
      { "id": 4, "name": "English", "slug": "english", "type": "MEDIUM" }
    ],
    "uploaderId": "user-uuid",
    "uploader": {
      "id": "user-uuid",
      "name": "User Name",
      "role": "TEACHER"
    },
    "createdAt": "2025-12-04T..."
  }
}
```

**Folder Hierarchy in Drive**:

```
ROOT_FOLDER_ID/
├── A/L/
│   ├── Combined Mathematics/
│   │   ├── Integration/
│   │   │   ├── English/
│   │   │   │   └── [file.pdf]
```

#### 2. Get Resources (with filtering)

```http
GET /resources?page=1&limit=10&search=integration&category=combined-mathematics&status=APPROVED
Authorization: Bearer <access_token> (optional)
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "resource-uuid",
        "title": "Integration Techniques",
        "description": "...",
        "driveFileId": "google_file_id",
        "mimeType": "application/pdf",
        "fileSize": 2048576,
        "status": "APPROVED",
        "views": 42,
        "downloads": 15,
        "categories": [...],
        "uploader": {...},
        "createdAt": "2025-12-04T..."
      }
    ],
    "meta": {
      "total": 50,
      "page": 1,
      "limit": 10,
      "totalPages": 5
    }
  }
}
```

#### 3. Get Resource Details

```http
GET /resources/:id
Authorization: Bearer <access_token> (optional)
```

**Response** (200): Returns single resource object with incremented view count

#### 4. Stream Resource File

```http
GET /resources/:id/stream
Authorization: Bearer <access_token> (optional)
Range: bytes=0-1023 (optional for partial content)
```

**Response** (200 or 206 for partial):

- Binary file stream
- Headers:
  - `Content-Type`: Actual file MIME type
  - `Content-Length`: File size
  - `Accept-Ranges: bytes` (if Range header supported)

---

### Forum Endpoints

#### 1. Get Questions

```http
GET /forum?page=1&limit=10&search=rotational&category=physics&solved=false
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "question-uuid",
        "title": "How to solve rotational motion?",
        "content": "Detailed question content...",
        "slug": "how-to-solve-rotational-motion-1701681234",
        "views": 120,
        "isSolved": false,
        "author": {
          "id": "user-uuid",
          "name": "User Name",
          "role": "STUDENT",
          "imageUrl": "https://..."
        },
        "categories": [
          { "id": 1, "name": "Physics", "slug": "physics", "type": "TAG" }
        ],
        "answers": []
      }
    ],
    "meta": {
      "total": 25,
      "page": 1,
      "limit": 10,
      "totalPages": 3
    }
  }
}
```

#### 2. Create Question

```http
POST /forum
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "title": "How to solve rotational motion?",
  "content": "Detailed explanation of the problem...",
  "categoryTags": ["physics", "mechanics"]
}
```

**Response** (201): Returns created question with author details

#### 3. Get Question with Answers

```http
GET /forum/:id
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "id": "question-uuid",
    "title": "...",
    "content": "...",
    "answers": [
      {
        "id": "answer-uuid",
        "content": "Answer from teacher...",
        "isAccepted": true,
        "upvotes": 23,
        "author": {
          "id": "user-uuid",
          "name": "Teacher Name",
          "role": "TEACHER",
          "imageUrl": "https://..."
        },
        "votes": [],
        "createdAt": "2025-12-04T...",
        "updatedAt": "2025-12-04T..."
      },
      {
        "id": "answer-uuid-2",
        "content": "Answer from student...",
        "isAccepted": false,
        "upvotes": 5,
        "author": {
          "id": "user-uuid",
          "name": "Student Name",
          "role": "STUDENT",
          "imageUrl": "https://..."
        },
        "votes": [],
        "createdAt": "2025-12-04T...",
        "updatedAt": "2025-12-04T..."
      }
    ],
    "categories": [...]
  }
}
```

**Sorting Order**: Teacher answers → Accepted answers → Highest upvotes

#### 4. Create Answer

```http
POST /forum/:id/answers
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "content": "Here's the solution to your problem..."
}
```

**Response** (201): Returns created answer object

#### 5. Vote on Answer

```http
POST /forum/answers/:id/vote
Authorization: Bearer <access_token>
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "voted": true
  }
}
```

_Note_: Voting toggles - calling again removes the vote

#### 6. Mark Answer as Accepted

```http
PATCH /forum/:id/answers/:answerId/accept
Authorization: Bearer <access_token>
```

**Response** (200): Returns updated answer object with `isAccepted: true`

_Note_: Only question author can mark answers as accepted

---

### Teacher Endpoints

#### 1. Get Teachers (with optional subject filter)

```http
GET /teachers?page=1&limit=10&subject=physics
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "teacher-profile-uuid",
        "userId": "user-uuid",
        "name": "Teacher Name",
        "email": "teacher@example.com",
        "imageUrl": "https://...",
        "bio": "Passionate educator...",
        "qualifications": "BSc Physics, MEd",
        "whatsappNumber": "+94701234567",
        "telegramUser": "@teacher_name",
        "isAvailable": true,
        "subjects": [
          { "id": 1, "name": "Physics", "slug": "physics" },
          {
            "id": 2,
            "name": "Combined Mathematics",
            "slug": "combined-mathematics"
          }
        ]
      }
    ],
    "meta": {
      "total": 12,
      "page": 1,
      "limit": 10,
      "totalPages": 2
    }
  }
}
```

#### 2. Get Teacher by ID

```http
GET /teachers/:id
```

**Response** (200): Single teacher object

#### 3. Get Teachers by Subject

```http
GET /teachers/subject/:slug?page=1&limit=10
```

**Response** (200): Array of teachers with that subject

---

### Category Endpoints

#### 1. Get All Categories

```http
GET /categories
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "data": [
      { "id": 1, "name": "O/L", "slug": "o-l", "type": "GRADE" },
      { "id": 2, "name": "Physics", "slug": "physics", "type": "SUBJECT" },
      {
        "id": 3,
        "name": "Integration",
        "slug": "integration",
        "type": "LESSON"
      },
      { "id": 4, "name": "English", "slug": "english", "type": "MEDIUM" },
      { "id": 5, "name": "PDF", "slug": "pdf", "type": "RESOURCE_TYPE" },
      { "id": 6, "name": "Difficult", "slug": "difficult", "type": "TAG" }
    ]
  }
}
```

#### 2. Get Category by Slug

```http
GET /categories/:slug
```

**Response** (200): Single category object

---

### Announcement Endpoints

#### 1. Get Announcements

```http
GET /announcements?page=1&limit=10&active=true
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "announcement-uuid",
        "title": "Server Maintenance",
        "content": "The platform will be down...",
        "priority": "HIGH",
        "isActive": true,
        "expiresAt": "2025-12-05T...",
        "author": {
          "id": "admin-uuid",
          "name": "Admin",
          "role": "ADMIN"
        },
        "createdAt": "2025-12-04T..."
      }
    ],
    "meta": {
      "total": 5,
      "page": 1,
      "limit": 10,
      "totalPages": 1
    }
  }
}
```

#### 2. Create Announcement (ADMIN only)

```http
POST /announcements
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "title": "Server Maintenance",
  "content": "The platform will be down for 2 hours...",
  "priority": "HIGH",
  "expiresAt": "2025-12-05T10:00:00Z"
}
```

**Response** (201): Created announcement object

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": {
    "message": "User not found",
    "statusCode": 404,
    "details": null
  }
}
```

### Common HTTP Status Codes

| Status | Meaning         | Example                     |
| ------ | --------------- | --------------------------- |
| 200    | Success         | GET request completed       |
| 201    | Created         | Resource created            |
| 206    | Partial Content | Range request for file      |
| 400    | Bad Request     | Missing required fields     |
| 401    | Unauthorized    | Invalid/missing token       |
| 403    | Forbidden       | Insufficient permissions    |
| 404    | Not Found       | Resource doesn't exist      |
| 500    | Server Error    | Google Drive quota exceeded |

---

## Category Types

Resources must be organized using the 4-level folder hierarchy:

| Level | Type    | Examples                               |
| ----- | ------- | -------------------------------------- |
| 1     | GRADE   | O/L, A/L, Grade 1-12                   |
| 2     | SUBJECT | Physics, Combined Mathematics, Biology |
| 3     | LESSON  | Integration, Forces, Atomic Structure  |
| 4     | MEDIUM  | English, Sinhala, Tamil                |

---

## Database Relationships

### User Roles

- **GUEST**: Default role, can view resources and forum
- **STUDENT**: Can upload resources, ask questions, answer
- **TEACHER**: Can upload, answer, have student profiles linking to them
- **ADMIN**: Can manage announcements

### Resource Status

- **PENDING**: Awaiting moderation
- **APPROVED**: Available to view
- **REJECTED**: Not approved
- **ARCHIVED**: Old/inactive resources

### Priority (Announcements)

- **NORMAL**: Regular announcements
- **HIGH**: Important updates
- **CRITICAL**: Urgent information

---

## Environment Variables

Required for deployment:

```env
DATABASE_URL=postgresql://user:password@host:port/database
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=refresh_token_for_service_account
ROOT_FOLDER_ID=google_drive_folder_id_for_resources
JWT_SECRET=your_jwt_secret_key
JWT_REFRESH_SECRET=your_refresh_secret_key
PORT=3000
```

---

## Example Workflows

### Workflow 1: Student Uploading Study Material

```
1. Student opens app and clicks "Upload"
2. POST /auth/google with idToken
3. System logs in/creates account
4. POST /auth/onboard with role=STUDENT, school, batch
5. Student selects file: "Physics_Integration.pdf"
6. Student fills: grade=A/L, subject=Physics, lesson=Integration, medium=English
7. POST /resources/upload with file + metadata
8. System creates Drive folder: /ROOT/A/L/Physics/Integration/English/
9. System uploads file to Drive
10. System creates Resource record in DB with categories
11. Student gets confirmation with resource ID
12. Resource status=PENDING (awaiting teacher approval)
```

### Workflow 2: Teacher Finding Resources by Subject

```
1. Teacher logs in
2. GET /teachers/subject/physics - finds all Physics teachers
3. GET /resources?category=physics&status=APPROVED
4. Teacher sees all approved Physics resources
5. GET /resources/:id/stream to download material
6. PUT /resources/:id to increment download count
```

### Workflow 3: Student Getting Help on Forum

```
1. Student reads existing questions: GET /forum?search=integration
2. Doesn't find answer, creates question: POST /forum
3. System creates question with slug for SEO
4. Teacher sees notification, posts answer: POST /forum/:id/answers
5. Other students upvote teacher answer: POST /forum/answers/:id/vote
6. Student marks teacher answer accepted: PATCH /forum/:id/answers/:answerId/accept
7. Question marked as isSolved=true
```

---

## Rate Limiting

Currently no rate limiting is implemented. Recommended limits:

- 100 requests/minute per IP
- 10 file uploads/day per user
- 50 forum posts/day per user

---

## Future Enhancements

- [ ] WebSocket for real-time notifications
- [ ] Advanced search with Elasticsearch
- [ ] Video resource support with transcoding
- [ ] Collaborative editing of notes
- [ ] Live tutoring sessions integration
- [ ] Recommendation engine for resources
- [ ] Mobile app specific endpoints
- [ ] Offline sync capability

---

## Support

For issues or questions:

- GitHub Issues: https://github.com/bhanuka-viraj/ape_archive_backend
- Email: support@resilientlearn.lk

---

**Last Updated**: December 4, 2025
**API Version**: 1.0
**Status**: Production Ready
