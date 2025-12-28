# Setup Guide

## Quick Start

1. **Install Dependencies**
```bash
npm install
# or
bun install
```

2. **Initialize Database**
```bash
node setup_db.js
```

3. **Start Development Servers**
```bash
npm run both
```

4. **Open Browser**
Navigate to http://localhost:5173

## Detailed Setup

### Prerequisites

- **Node.js**: Version 18 or higher
- **npm** or **bun**: Package manager
- **Git**: For version control operations

### Step-by-Step Installation

#### 1. Clone Repository

```bash
git clone <repository-url>
cd sync-docs
```

#### 2. Install Dependencies

```bash
npm install
```

This installs:
- **Backend**: express, socket.io, sqlite3, simple-git, y-socket.io
- **Frontend**: tiptap, yjs, socket.io-client, vite
- **Dev Tools**: vite (bundler)

#### 3. Initialize Database

```bash
node setup_db.js
```

This creates:
- `syncdocs.db` SQLite database
- `users` table
- `documents` table
- `permissions` table

#### 4. Start Servers

**Option A: Both servers together**
```bash
npm run both
```

**Option B: Separate terminals**
```bash
# Terminal 1 - Backend
npm run dev:be

# Terminal 2 - Frontend
npm run dev:fe
```

#### 5. Verify Installation

- Backend should show: `Server running on port 3000`
- Frontend should show: `Local: http://localhost:5173`
- Open browser to http://localhost:5173
- You should see the login screen

## Configuration

### Environment Variables

Create a `.env` file (optional):

```env
PORT=3000
NODE_ENV=development
```

### Database Location

Default: `syncdocs.db` in project root

To change: Modify `db.js`

### Document Storage

Default: `document_storage/` in project root

Created automatically on first document creation.

## Troubleshooting

### Port Already in Use

**Backend (3000):**
```bash
# Find and kill process
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9
```

**Frontend (5173):**
Vite will automatically use next available port (5174, 5175, etc.)

### Database Errors

**Reset database:**
```bash
rm syncdocs.db
node setup_db.js
```

**Check database:**
```bash
sqlite3 syncdocs.db ".tables"
sqlite3 syncdocs.db "SELECT * FROM users;"
```

### Git Errors

**Check Git installation:**
```bash
git --version
```

**Reset document storage:**
```bash
rm -rf document_storage/
# Documents will be recreated on next creation
```

### Socket.io Connection Issues

**Check browser console:**
- Look for WebSocket connection errors
- Verify Socket.io is connecting: `io()` should show in Network tab

**Check server logs:**
- Look for Socket.io connection messages
- Verify CORS settings if accessing from different origin

### Module Not Found Errors

**Reinstall dependencies:**
```bash
rm -rf node_modules package-lock.json
npm install
```

## Production Deployment

### Build Frontend

```bash
npm run build
# or
vite build
```

This creates `dist/` folder with production assets.

### Serve Static Files

Update `server.js`:
```javascript
app.use(express.static('dist')); // Instead of 'public'
```

### Environment Setup

1. Set `NODE_ENV=production`
2. Use production database (PostgreSQL recommended)
3. Configure HTTPS
4. Set up reverse proxy (nginx)
5. Configure CORS for production domain

### Database Migration

For production, migrate to PostgreSQL:

1. Update `db.js` to use `pg` instead of `sqlite3`
2. Run migrations:
```sql
CREATE TABLE users (...);
CREATE TABLE documents (...);
CREATE TABLE permissions (...);
```

### Process Management

Use PM2 or similar:
```bash
npm install -g pm2
pm2 start server.js --name sync-docs
pm2 save
pm2 startup
```

## Development Tips

### Hot Reload

- **Frontend**: Vite provides hot module replacement
- **Backend**: Restart server after changes (or use nodemon)

### Debugging

**Backend:**
```bash
node --inspect server.js
# Then connect Chrome DevTools to chrome://inspect
```

**Frontend:**
- Use browser DevTools
- Check Console for errors
- Check Network tab for API calls
- Check Application tab for LocalStorage

### Database Inspection

```bash
# Open SQLite shell
sqlite3 syncdocs.db

# Useful commands:
.tables          # List tables
.schema users    # Show table schema
SELECT * FROM documents;
```

### Git Inspection

```bash
# Check document Git history
cd document_storage/doc_1
git log --oneline
git show HEAD
```

## Common Issues

### "Cannot read property of undefined"

- Check that user is logged in
- Verify localStorage has `syncdocs_user`
- Check API responses in Network tab

### "Document not found"

- Verify document exists in database
- Check document ID in URL
- Verify user has permission

### "Permission denied"

- Check user role in database
- Verify userId is correct
- Check permission table

### Collaboration not working

- Verify both servers running
- Check Socket.io connection
- Verify Y.js provider is connected
- Check browser console for errors

## Next Steps

After setup:
1. Create a user account
2. Create a test document
3. Open in multiple browsers to test collaboration
4. Test sharing with another user
5. Test rollback functionality

