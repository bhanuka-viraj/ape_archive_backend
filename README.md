# Ape Archive

A disaster relief education platform that acts as a central proxy for Google Drive resources. Built with [Elysia.js](https://elysiajs.com/) and [Bun](https://bun.sh/), enabling students and teachers in Sri Lanka affected by cyclones to share and access educational materials seamlessly.

## 🚀 Features

- **High Performance**: Built on top of Bun and Elysia for blazing fast request processing.
- **Google Drive Integration**: Stream files directly from Google Drive with 4-level folder hierarchy organization.
- **Authentication**: Secure user authentication using Google OAuth and JWT.
- **Role-Based Access Control (RBAC)**: Distinct roles for Students, Teachers, and Admins.
- **Resource Management**: Upload, categorize, and manage educational resources with approval workflow (Grade → Subject → Lesson → Medium).
- **Forum System**: Q&A platform with role-based answer sorting (Teachers > Students), upvoting, and accepted answers.
- **Teacher Discovery**: Find teachers by subject specialty.
- **Announcements**: Priority-based announcement system for critical information.
- **Structured Logging**: Comprehensive logging using Winston with HTTP request tracking.
- **API Documentation**: Integrated Swagger UI and detailed endpoint documentation.

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Framework**: [Elysia.js](https://elysiajs.com/) (v1.1+)
- **Database**: PostgreSQL
- **ORM**: [Prisma](https://www.prisma.io/)
- **Cloud Storage**: Google Drive API with streaming support
- **Authentication**: Google OAuth2 + JWT
- **Logging**: Winston
- **Documentation**: Swagger

## 📋 Prerequisites

Ensure you have the following installed:

- [Bun](https://bun.sh/) (v1.3+)
- PostgreSQL (v12+)
- Google Cloud Project with Drive API enabled

## ⚙️ Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/bhanuka-viraj/ape_archive_backend.git
    cd ape_archive_backend
    ```

2.  **Install dependencies:**

    ```bash
    bun install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory and add the following:

    ```env
    # Server Configuration
    PORT=3000
    DATABASE_URL=postgresql://user:password@localhost:5432/ape_archive

    # Google OAuth
    GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
    GOOGLE_CLIENT_SECRET=your_client_secret
    GOOGLE_REFRESH_TOKEN=your_refresh_token
    ROOT_FOLDER_ID=your_drive_folder_id

    # JWT Configuration
    JWT_SECRET=your_super_secret_key_min_32_chars
    JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars
    NODE_ENV=development
    ```

4.  **Generate Prisma Client:**

    ```bash
    bun run generate
    ```

5.  **Run Database Migrations:**
    ```bash
    bun prisma migrate dev
    ```

## 🏃‍♂️ Running the Application

Start the development server:

```bash
bun dev
```

The server will start at `http://localhost:3000`.

## 📚 API Documentation

Once the server is running, you can access:

1. **Interactive Swagger UI**: `http://localhost:3000/swagger`
2. **Detailed API Guide**: See `API_DOCUMENTATION.md` in the project root

## 📂 Project Structure

```
src/
├── config/         # Configuration files (DB, Env)
├── controllers/    # Request handlers
├── dto/            # Data Transfer Objects
├── middlewares/    # Custom middlewares (Auth, Security)
├── models/         # Database models (if separate from Prisma)
├── plugins/        # Elysia plugins (Logger, Swagger)
├── routes/         # API Route definitions
├── services/       # Business logic
├── utils/          # Utility functions (Logger, Error handling)
└── app.ts          # App entry point
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
