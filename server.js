const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { YSocketIO } = require('y-socket.io/dist/server');
const db = require('./db');
const simpleGit = require('simple-git');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Y-Socket.io setup
const ySocketIO = new YSocketIO(io, {
  // authenticate: (auth) => { return true; } // Optional auth
});
ySocketIO.initialize();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize database tables if they don't exist
async function initializeDatabase() {
  try {
    // Check if users table exists
    const tablesCheck = await db.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('users', 'documents', 'permissions')
    `);
    
    const existingTables = tablesCheck.rows.map(row => row.name);
    
    if (!existingTables.includes('users')) {
      console.log("Initializing database tables...");
      
      // Users table
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL
        );
      `);
      
      // Documents table
      await db.query(`
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          fs_path TEXT UNIQUE NOT NULL,
          owner_id INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // Permissions table
      await db.query(`
        CREATE TABLE IF NOT EXISTS permissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('owner', 'writer', 'reader')),
          UNIQUE(document_id, user_id)
        );
      `);
      
      console.log("Database tables initialized successfully.");
    }
  } catch (err) {
    console.error("Error initializing database:", err);
    // Don't exit - let server start anyway, but log the error
  }
}

// Initialize database on startup
initializeDatabase();

// Git Setup - Base directory for all document repos
const STORAGE_PATH = path.join(__dirname, 'document_storage');
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH);
}

// Helper to get git instance for a document
function getDocumentGit(docId) {
  const docPath = path.join(STORAGE_PATH, `doc_${docId}`);
  return simpleGit(docPath);
}

// Helper to get document path
function getDocumentPath(docId) {
  return path.join(STORAGE_PATH, `doc_${docId}`);
}

// Helper to initialize a document's git repo
async function initDocumentRepo(docId) {
  const docPath = getDocumentPath(docId);
  if (!fs.existsSync(docPath)) {
    fs.mkdirSync(docPath, { recursive: true });
  }
  const git = getDocumentGit(docId);
  await git.init();
  await git.addConfig('user.name', 'Collaboration Docs Bot');
  await git.addConfig('user.email', 'bot@collaboration-docs.local');
  return git;
}

// API Routes

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, password]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Username likely taken' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (user.password === password) {
        res.json({ id: user.id, username: user.username });
        return;
      }
    }
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List Documents
app.get('/api/documents', async (req, res) => {
  const userId = req.query.userId;
  try {
    // Get docs owned or shared - using UNION to avoid duplicates
    const result = await db.query(`
      SELECT d.id, d.name, d.path, d.fs_path, d.owner_id, d.created_at, 'owner' as role
      FROM documents d
      WHERE d.owner_id = $1
      UNION
      SELECT d.id, d.name, d.path, d.fs_path, d.owner_id, d.created_at, p.role
      FROM documents d
      INNER JOIN permissions p ON d.id = p.document_id
      WHERE p.user_id = $2 AND d.owner_id != $3
    `, [userId, userId, userId]);
    console.log('Documents for user', userId, ':', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing documents:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create Document
app.post('/api/documents', async (req, res) => {
  const { name, userId } = req.body;
  const filename = 'document.md'; // Always use same filename in each doc's repo
  
  try {
    // Create document in DB first to get ID
    const result = await db.query(
      'INSERT INTO documents (name, path, fs_path, owner_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, '/', filename, userId]
    );
    
    const docId = result.rows[0].id;
    
    // Initialize git repo for this document
    const git = await initDocumentRepo(docId);
    
    // Create empty file
    const docPath = getDocumentPath(docId);
    const fullPath = path.join(docPath, filename);
    fs.writeFileSync(fullPath, '');
    
    // Initial commit
    await git.add(filename);
    await git.commit(`Create document ${name}`);
    
    // Add owner permission
    await db.query('INSERT INTO permissions (document_id, user_id, role) VALUES ($1, $2, $3)', 
      [docId, userId, 'owner']);

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get Document Content
app.get('/api/documents/:id/content', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.query;
    try {
        const docRes = await db.query('SELECT fs_path FROM documents WHERE id = $1', [id]);
        if (docRes.rows.length === 0) return res.status(404).send('Doc not found');
        
        // Get user's role for this document
        const role = await getUserDocumentRole(userId, id);
        
        const fsPath = docRes.rows[0].fs_path;
        const docPath = getDocumentPath(id);
        const fullPath = path.join(docPath, fsPath);
        
        let content = '';
        if (fs.existsSync(fullPath)) {
            content = fs.readFileSync(fullPath, 'utf8');
        }
        
        res.json({ content, role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Document History
app.get('/api/documents/:id/history', async (req, res) => {
  const { id } = req.params;
  try {
    const docRes = await db.query('SELECT fs_path FROM documents WHERE id = $1', [id]);
    if (docRes.rows.length === 0) return res.status(404).send('Doc not found');
    
    const git = getDocumentGit(id);
    const log = await git.log();
    
    // Show all commits (rollback commits are now regular commits that can be undone)
    const filteredLog = log.all;
    
    res.json(filteredLog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rollback (Checkout content from commit and commit as new commit - can be undone)
app.post('/api/documents/:id/rollback', async (req, res) => {
  const { id } = req.params;
  const { hash } = req.body;
  
  try {
    const docRes = await db.query('SELECT fs_path FROM documents WHERE id = $1', [id]);
    if (docRes.rows.length === 0) return res.status(404).send('Doc not found');
    
    const fsPath = docRes.rows[0].fs_path;
    const docPath = getDocumentPath(id);
    const fullPath = path.join(docPath, fsPath);
    const git = getDocumentGit(id);
    
    // Get current HEAD to ensure we're not resetting
    const currentLog = await git.log();
    const currentHead = currentLog.latest?.hash;
    
    // Get the file content from the target commit
    let fileContent = '';
    try {
      fileContent = await git.show([`${hash}:${fsPath}`]);
    } catch (showErr) {
      // File might be empty at creation
      fileContent = '';
    }
    
    // Read current file content to check if there are changes
    let currentContent = '';
    if (fs.existsSync(fullPath)) {
      currentContent = fs.readFileSync(fullPath, 'utf8');
    }
    
    // Write the content to the file
    fs.writeFileSync(fullPath, fileContent);
    
    // Get commit info for better message
    let commitMessage = 'Revert to previous version';
    try {
      const commitInfo = await git.show([hash, '--format=%s', '--no-patch']);
      commitMessage = `Revert to: ${commitInfo.trim().substring(0, 50)}`;
    } catch (err) {
      // Use default message if we can't get commit info
    }
    
    // Stage the file
    await git.add(fsPath);
    
    // Check if there are changes to commit
    const status = await git.status();
    const hasChanges = status.modified.includes(fsPath) || 
                       status.not_added.includes(fsPath) || 
                       (currentContent !== fileContent);
    
    if (hasChanges) {
      // Commit the rollback (this creates a new commit, preserving history)
      await git.commit(commitMessage);
    } else {
      // Even if content is the same, create an empty commit to mark the rollback
      await git.commit(commitMessage, ['--allow-empty']);
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Rollback error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Delete Document
app.delete('/api/documents/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const docRes = await db.query('SELECT fs_path FROM documents WHERE id = $1', [id]);
    if (docRes.rows.length === 0) return res.status(404).json({error: 'Doc not found'});
    
    // Delete entire document directory
    const docPath = getDocumentPath(id);
    if (fs.existsSync(docPath)) {
      fs.rmSync(docPath, { recursive: true, force: true });
    }
    
    // Delete from database (cascade will delete permissions)
    await db.query('DELETE FROM documents WHERE id = $1', [id]);
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Add Owner/Worker (Share)
app.post('/api/documents/:id/share', async (req, res) => {
  const { id } = req.params;
  const { username, role } = req.body; // role: 'writer' or 'reader'
  
  try {
    const userRes = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) return res.status(404).json({error: 'User not found'});
    
    const targetUserId = userRes.rows[0].id;
    
    // Get document info for notification
    const docRes = await db.query('SELECT name FROM documents WHERE id = $1', [id]);
    const docName = docRes.rows[0]?.name || 'Unknown';
    
    await db.query(`
      INSERT INTO permissions (document_id, user_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (document_id, user_id) DO UPDATE SET role = $3
    `, [id, targetUserId, role]);
    
    // Emit socket event to notify the user
    io.emit('document-shared', {
      userId: targetUserId,
      documentId: id,
      documentName: docName,
      role: role
    });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Git lock management
const gitLocks = new Map();

// Get user's role for a document
async function getUserDocumentRole(userId, documentId) {
  try {
    // Check if user is owner
    const ownerRes = await db.query('SELECT owner_id FROM documents WHERE id = $1', [documentId]);
    if (ownerRes.rows.length === 0) return null;
    if (ownerRes.rows[0].owner_id == userId) return 'owner';
    
    // Check permissions table
    const permRes = await db.query(
      'SELECT role FROM permissions WHERE document_id = $1 AND user_id = $2',
      [documentId, userId]
    );
    if (permRes.rows.length > 0) return permRes.rows[0].role;
    
    return null;
  } catch (err) {
    console.error('Error getting user role:', err);
    return null;
  }
}

// Save Document
app.post('/api/documents/:id/save', async (req, res) => {
    const { id } = req.params;
    const { content, userId } = req.body;
    
    // Check permissions
    const role = await getUserDocumentRole(userId, id);
    if (!role || (role !== 'owner' && role !== 'writer')) {
        return res.status(403).json({ error: 'Forbidden: You do not have write permission for this document' });
    }
    
    // Check if there's already a save in progress for this document
    if (gitLocks.get(id)) {
        return res.json({ success: true, queued: true }); // Silently ignore if already saving
    }
    
    gitLocks.set(id, true);
    
    try {
        const docRes = await db.query('SELECT fs_path FROM documents WHERE id = $1', [id]);
        if (docRes.rows.length === 0) {
            gitLocks.delete(id);
            return res.status(404).send('Doc not found');
        }
        
        const fsPath = docRes.rows[0].fs_path;
        const docPath = getDocumentPath(id);
        const fullPath = path.join(docPath, fsPath);
        
        fs.writeFileSync(fullPath, content);
        
        // Git commit if changed
        const git = getDocumentGit(id);
        const status = await git.status();
        if (status.modified.includes(fsPath) || status.not_added.includes(fsPath)) {
            await git.add(fsPath);
            await git.commit(`Update document`);
        }
        
        gitLocks.delete(id);
        res.json({ success: true });
    } catch(err) {
        console.error(err);
        gitLocks.delete(id);
        res.status(500).json({ error: err.message });
    }
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
