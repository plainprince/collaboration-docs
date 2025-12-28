# Architecture Documentation

## System Overview

Collaboration Docs is a real-time collaborative document editor that combines CRDT-based conflict resolution with Git-based version control. The system is designed to handle multiple simultaneous editors while maintaining data consistency and providing full version history.

## Component Architecture

### Frontend Components

#### 1. Authentication System (`src/main.js`)
- **LocalStorage-based Session**: User credentials stored in browser localStorage
- **Session Persistence**: Automatically logs in user on page reload
- **Key**: `collaboration_docs_user` (stores user object with id and username)

#### 2. Document Management
- **Document List**: Fetches user's documents from `/api/documents`
- **Role Display**: Shows user's role (owner/writer/reader) for each document
- **Document Actions**: Open, Delete (owner only)

#### 3. Editor System
- **Tiptap Editor**: Rich text editor instance
- **Y.js Integration**: CRDT document synchronization
- **Socket.io Provider**: Real-time WebSocket connection
- **Collaboration Cursor**: Shows other users' cursors in real-time
- **Read-only Mode**: Disables editing for readers

#### 4. Real-time Synchronization Flow

```
User Types → Tiptap Editor → Y.Doc (local) → Socket.io → Server → Broadcast → Other Clients → Y.Doc (remote) → Tiptap Editor
```

### Backend Components

#### 1. Express Server (`server.js`)
- **HTTP API**: RESTful endpoints for document operations
- **WebSocket Server**: Socket.io for real-time communication
- **Y-Socket.io Integration**: Handles Y.js synchronization protocol

#### 2. Database Layer (`db.js`)
- **SQLite Wrapper**: Mimics PostgreSQL interface for portability
- **Query Translation**: Converts PostgreSQL-style queries (`$1`, `$2`) to SQLite (`?`)
- **Result Formatting**: Returns results in PostgreSQL-compatible format

#### 3. Git Operations
- **Per-Document Repos**: Each document has isolated Git repository
- **Path Structure**: `document_storage/doc_{id}/.git`
- **File Naming**: All documents use `document.md` filename
- **Commit Strategy**: Auto-save every 60 seconds or manual save

#### 4. Permission System
- **Role-based Access Control**: Owner, Writer, Reader
- **Permission Checks**: Backend validates permissions before operations
- **Frontend Enforcement**: UI disables actions based on role

## Data Flow

### Document Creation Flow

```
1. User clicks "Create"
   ↓
2. POST /api/documents
   ↓
3. Create DB record → Get document ID
   ↓
4. Initialize Git repo: document_storage/doc_{id}/
   ↓
5. Create document.md file
   ↓
6. Git commit: "Create document {name}"
   ↓
7. Return document object to frontend
   ↓
8. Refresh document list
```

### Document Editing Flow

```
1. User types in editor
   ↓
2. Tiptap onUpdate event (debounced 60s)
   ↓
3. Y.js applies change locally
   ↓
4. Y.js syncs via Socket.io
   ↓
5. Server receives update
   ↓
6. Server broadcasts to other clients
   ↓
7. Other clients receive and merge
   ↓
8. Auto-save triggers: POST /api/documents/:id/save
   ↓
9. Server writes to file
   ↓
10. Git commit: "Update document"
```

### Rollback Flow

```
1. User clicks "Rollback to this version"
   ↓
2. Confirm dialog shown
   ↓
3. POST /api/documents/:id/rollback { hash }
   ↓
4. Server: git reset --hard {hash}
   ↓
5. File content reset to commit state
   ↓
6. Frontend fetches new content
   ↓
7. Editor content updated
   ↓
8. History refreshed (removed commits no longer visible)
```

## Storage Architecture

### File System Structure

```
document_storage/
├── doc_1/
│   ├── .git/
│   │   ├── HEAD
│   │   ├── refs/
│   │   └── objects/
│   └── document.md
├── doc_2/
│   ├── .git/
│   └── document.md
└── ...
```

### Database Schema

**users**
- `id` INTEGER PRIMARY KEY
- `username` TEXT UNIQUE
- `password` TEXT

**documents**
- `id` INTEGER PRIMARY KEY
- `name` TEXT
- `path` TEXT
- `fs_path` TEXT (always 'document.md')
- `owner_id` INTEGER REFERENCES users(id)
- `created_at` TIMESTAMP

**permissions**
- `document_id` INTEGER REFERENCES documents(id)
- `user_id` INTEGER REFERENCES users(id)
- `role` TEXT ('owner', 'writer', 'reader')
- PRIMARY KEY (document_id, user_id)

## Real-time Collaboration Details

### Y.js CRDT

Y.js uses a CRDT (Conflict-free Replicated Data Type) algorithm:
- **Operations are Commutative**: Order doesn't matter
- **Idempotent**: Applying same operation twice has no effect
- **Associative**: Grouping doesn't matter

### Y.Doc Structure

```javascript
Y.Doc {
  getText('default'): Y.Text  // Main document content
  // ProseMirror integration via y-prosemirror
}
```

### Awareness System

Tracks user presence:
- **Local State**: Current user's cursor position, name, color
- **Remote State**: Other users' cursors
- **Updates**: Broadcasted via Socket.io

### Socket.io Rooms

Each document has its own room:
- **Room Name**: Document ID
- **Join**: When user opens document
- **Leave**: When user closes document
- **Broadcast**: All updates sent to room

## Security Model

### Current Implementation (Development)

- **Authentication**: Simple username/password (plain text)
- **Authorization**: Role-based checks in backend
- **Session**: LocalStorage (no server-side sessions)
- **HTTPS**: Not enforced (development only)

### Production Considerations

1. **Password Hashing**: Use bcrypt or Argon2
2. **JWT Tokens**: Replace LocalStorage with secure tokens
3. **HTTPS**: Enforce SSL/TLS
4. **CORS**: Configure properly for production domain
5. **Rate Limiting**: Prevent abuse
6. **Input Sanitization**: Sanitize HTML before saving
7. **SQL Injection**: Already using parameterized queries
8. **XSS Protection**: Escape user content

## Performance Considerations

### Frontend

- **Debouncing**: Auto-save debounced to 60 seconds
- **Lazy Loading**: Documents loaded on demand
- **Connection Pooling**: Socket.io reuses connections

### Backend

- **Git Locking**: Prevents concurrent Git operations
- **Async Operations**: All I/O is asynchronous
- **Connection Reuse**: Socket.io handles connection pooling

### Scalability Limitations

Current implementation is single-server:
- **Socket.io**: Single server instance
- **Git Repos**: Local file system
- **Database**: SQLite (single file)

For horizontal scaling, consider:
- **Redis**: For Socket.io adapter
- **PostgreSQL**: For database
- **Shared File System**: For Git repos (or Git server)

## Error Handling

### Frontend

- **API Errors**: Displayed as toast notifications
- **Connection Errors**: Socket.io auto-reconnects
- **Editor Errors**: Caught and logged to console

### Backend

- **Git Errors**: Caught and returned as 500 errors
- **Database Errors**: Caught and returned with error message
- **Permission Errors**: Return 403 Forbidden

## Testing Considerations

### Unit Tests Needed

- Database operations
- Git operations
- Permission checks
- API endpoints

### Integration Tests Needed

- Document creation flow
- Real-time synchronization
- Rollback operations
- Permission enforcement

### Manual Testing Checklist

- [ ] Create document
- [ ] Edit document
- [ ] Share document
- [ ] Test reader permissions
- [ ] Test writer permissions
- [ ] Test rollback
- [ ] Test real-time collaboration (multiple browsers)
- [ ] Test auto-save
- [ ] Test manual save
- [ ] Test history view

