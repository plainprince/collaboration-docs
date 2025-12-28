# Collaboration Docs - Real-time Collaborative Document Editor

A real-time collaborative document editor built with modern web technologies, featuring CRDT-based conflict-free editing, Git-based version control, and WebSocket-powered live collaboration.

## Features

- **Real-time Collaboration**: Multiple users can edit documents simultaneously with live cursor tracking
- **CRDT-based Editing**: Conflict-free replicated data types (Y.js) ensure consistency across all clients
- **Git Version Control**: Each document has its own Git repository for complete version history
- **Role-based Permissions**: Owner, Writer, and Reader roles with proper access control
- **Document Sharing**: Share documents with other users and assign roles
- **History & Rollback**: View document history and rollback to any previous version
- **Rich Text Editing**: Full-featured WYSIWYG editor with formatting options
- **Dark Mode UI**: Modern dark theme interface

## Architecture

### Technology Stack

**Frontend:**
- Pure HTML/CSS/JavaScript (no framework)
- Tiptap rich text editor
- Y.js for CRDT synchronization
- Socket.io client for real-time communication
- Vite for bundling and development

**Backend:**
- Node.js with Express
- Socket.io for WebSocket communication
- Y-Socket.io for CRDT synchronization
- SQLite for user and document metadata
- Simple-git for Git operations

### Data Structure

```
document_storage/
├── doc_1/
│   ├── .git/          # Git repository for document 1
│   └── document.md    # Document content
├── doc_2/
│   ├── .git/          # Git repository for document 2
│   └── document.md    # Document content
└── ...
```

Each document has its own isolated Git repository, allowing for true history rollback without affecting other documents.

## Installation

### Prerequisites

- Node.js (v18 or higher)
- npm or bun

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd sync-docs
```

2. Install dependencies:
```bash
npm install
# or
bun install
```

3. Initialize the database:
```bash
node setup_db.js
```

4. Start the development servers:
```bash
# Start both frontend and backend
npm run both

# Or start separately:
npm run dev:be  # Backend server (port 3000)
npm run dev:fe  # Frontend dev server (port 5173)
```

## Usage

### Creating an Account

1. Open the application in your browser (default: http://localhost:5173)
2. Enter a username and password
3. Click "Register" to create an account
4. You'll be automatically logged in

### Creating Documents

1. After logging in, enter a document name in the "New Document Name" field
2. Click "Create"
3. The document will appear in your document list
4. Click "Open" to start editing

### Sharing Documents

1. Open a document you own
2. Click the "Share" button
3. Enter the username of the person you want to share with
4. Select their role:
   - **Owner**: Full control, can delete and share
   - **Writer**: Can edit and save
   - **Reader**: Read-only access
5. Click "Share"

### Viewing History and Rolling Back

1. Open a document
2. Click the "History" button
3. View all commits for the document
4. Click "Rollback to this version" on any commit
5. Confirm the rollback (this action cannot be undone)
6. The document will be reset to that version, and all subsequent commits will be removed

### Editing Documents

- Use the toolbar buttons for formatting (bold, italic, headings, lists, etc.)
- Changes are automatically saved every 60 seconds
- Click "Save" to manually save immediately
- Multiple users can edit simultaneously - you'll see their cursors in real-time

## API Endpoints

### Authentication
- `POST /api/register` - Create a new user account
- `POST /api/login` - Login and get user session

### Documents
- `GET /api/documents?userId={id}` - List all documents for a user
- `POST /api/documents` - Create a new document
- `DELETE /api/documents/:id` - Delete a document (owner only)
- `GET /api/documents/:id/content?userId={id}` - Get document content and user role
- `POST /api/documents/:id/save` - Save document content
- `GET /api/documents/:id/history` - Get document commit history
- `POST /api/documents/:id/rollback` - Rollback document to a specific commit
- `POST /api/documents/:id/share` - Share document with another user

## Database Schema

### Users Table
- `id` - Primary key
- `username` - Unique username
- `password` - Plain text password (for simplicity - use hashing in production)

### Documents Table
- `id` - Primary key
- `name` - Document name
- `path` - Virtual path (currently '/')
- `fs_path` - Filename in storage ('document.md')
- `owner_id` - Foreign key to users table
- `created_at` - Timestamp

### Permissions Table
- `document_id` - Foreign key to documents
- `user_id` - Foreign key to users
- `role` - 'owner', 'writer', or 'reader'
- Primary key: (document_id, user_id)

## Real-time Collaboration

The application uses Y.js (CRDT) for conflict-free editing:

1. Each document has a Y.Doc instance
2. Changes are synchronized via Socket.io
3. Y-Socket.io handles the WebSocket protocol
4. Tiptap Collaboration extension integrates Y.js with the editor
5. Collaboration Cursor extension shows other users' cursors

### How It Works

1. User opens a document → Frontend creates Y.Doc and connects via Socket.io
2. User types → Changes are applied to Y.Doc locally
3. Y.js syncs → Changes are broadcast to server via Socket.io
4. Server broadcasts → Other connected clients receive updates
5. Other clients apply → Changes are merged into their Y.Doc instances
6. Editor updates → Tiptap reflects the merged changes

## Version Control

Each document has its own Git repository:

- **Initial Commit**: Created when document is first created
- **Auto-save**: Commits are created every 60 seconds or on manual save
- **Rollback**: Uses `git reset --hard` to permanently remove commits after a point
- **History**: Shows all commits for the document (excluding rollback/reset commits)

## Security Considerations

⚠️ **This is a development/demo application. For production use:**

1. **Password Hashing**: Currently uses plain text passwords - implement bcrypt or similar
2. **Authentication**: Add JWT tokens or session management
3. **Authorization**: Add middleware to verify permissions on all endpoints
4. **Input Validation**: Sanitize all user inputs
5. **HTTPS**: Use HTTPS in production
6. **Rate Limiting**: Add rate limiting to prevent abuse
7. **SQL Injection**: Use parameterized queries (already implemented)
8. **XSS Protection**: Sanitize HTML content before saving

## Development

### Project Structure

```
.
├── server.js              # Express backend server
├── db.js                  # Database connection wrapper
├── setup_db.js            # Database initialization script
├── package.json           # Dependencies and scripts
├── document_storage/      # Document repositories (created at runtime)
├── collaboration-docs.db   # SQLite database (created by setup_db.js)
└── src/
    ├── index.html         # Main HTML file
    ├── main.js            # Frontend application logic
    └── style.css          # Stylesheet
```

### Key Files

- **server.js**: Express server, API routes, Socket.io setup, Git operations
- **src/main.js**: Frontend logic, Tiptap editor setup, Y.js integration
- **db.js**: SQLite wrapper that mimics PostgreSQL interface
- **setup_db.js**: Creates database tables

## Troubleshooting

### Documents not appearing
- Check that the database was initialized: `node setup_db.js`
- Verify user is logged in (check localStorage)
- Check browser console for errors

### Collaboration not working
- Ensure both frontend and backend servers are running
- Check Socket.io connection in browser DevTools Network tab
- Verify Y.js provider is connecting: check console logs

### Rollback not working
- Ensure document was created with new system (after refactor)
- Check that document has its own Git repo in `document_storage/doc_{id}/`
- Verify Git operations in server logs

### Permission errors
- Ensure userId is being passed correctly in API calls
- Check database permissions table
- Verify role is 'owner' or 'writer' for write operations

## License

ISC

## Contributing

This is a demo/educational project. Feel free to fork and modify as needed.

## Acknowledgments

- [Tiptap](https://tiptap.dev/) - Rich text editor framework
- [Y.js](https://github.com/yjs/yjs) - CRDT library
- [Socket.io](https://socket.io/) - Real-time communication
- [Simple-git](https://github.com/steveukx/git-js) - Git operations

