// ...
// ...
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { SocketIOProvider } from 'y-socket.io'; 
import io from 'socket.io-client';
import { yCursorPlugin } from '@tiptap/y-tiptap';

// Custom CollaborationCursor using @tiptap/y-tiptap (to match Collaboration extension)
const CollaborationCursor = Extension.create({
  name: 'collaborationCursor',
  addOptions() {
    return {
      provider: null,
      user: {
        name: null,
        color: null,
      },
      render: user => {
        const cursor = document.createElement('span');
        cursor.classList.add('collaboration-cursor__caret');
        const bgColor = user.color || '#8ab4f8';
        cursor.setAttribute('style', `border-color: ${bgColor}`);
        
        const label = document.createElement('div');
        label.classList.add('collaboration-cursor__label');
        
        // Set background color - use the user's color with good opacity
        label.style.backgroundColor = bgColor;
        label.style.opacity = '0.9';
        
        // Determine text color based on HSL lightness (simpler than RGB conversion)
        // For HSL colors, check the lightness value
        let textColor = '#fff'; // Default to white
        if (bgColor.startsWith('hsl')) {
          const hslMatch = bgColor.match(/hsl\(\d+,\s*\d+%,\s*(\d+)%\)/);
          if (hslMatch) {
            const lightness = parseInt(hslMatch[1]);
            // If lightness is above 60%, use dark text, otherwise light text
            textColor = lightness > 60 ? '#000' : '#fff';
          }
        } else {
          // For hex colors, use white text (most colors will be dark enough)
          textColor = '#fff';
        }
        
        label.style.color = textColor;
        label.style.borderColor = `rgba(255, 255, 255, 0.3)`;
        
        label.insertBefore(document.createTextNode(user.name), null);
        cursor.insertBefore(label, null);
        return cursor;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      yCursorPlugin((() => {
        this.options.provider.awareness.setLocalStateField('user', this.options.user);
        this.options.provider.awareness.on('update', () => {
          // Optional: track users
        });
        return this.options.provider.awareness;
      })(), {
        cursorBuilder: this.options.render,
      }),
    ];
  },
});

// App State
const state = {
  user: null,
  currentDoc: null,
  editor: null,
  provider: null,
  socket: null,
  currentDocRole: null // Track current document role
};

// Elements
const screens = {
  auth: document.getElementById('auth-screen'),
  dashboard: document.getElementById('dashboard-screen'),
  editor: document.getElementById('editor-screen')
};

// Utils
const showScreen = (name) => {
  Object.values(screens).forEach(el => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
};

const api = async (endpoint, method = 'GET', body = null) => {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`/api${endpoint}`, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// Custom Alert (Toast notification)
function showAlert(message, type = 'info') {
  const alertEl = document.getElementById('custom-alert');
  alertEl.textContent = message;
  alertEl.className = `custom-alert ${type}`;
  
  // Remove hidden class
  alertEl.classList.remove('hidden');
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    alertEl.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      alertEl.classList.add('hidden');
      alertEl.style.animation = '';
    }, 300);
  }, 3000);
  
  // Click to dismiss
  alertEl.onclick = () => {
    alertEl.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      alertEl.classList.add('hidden');
      alertEl.style.animation = '';
    }, 300);
  };
}

// Custom Confirm Dialog
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const confirmEl = document.getElementById('custom-confirm');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmEl.classList.remove('hidden');
    
    const cleanup = () => {
      confirmEl.classList.add('hidden');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
    };
    
    okBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
    
    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
}

// Auth
function checkAuth() {
    const storedUser = localStorage.getItem('collaboration_docs_user');
    if (storedUser) {
        state.user = JSON.parse(storedUser);
        initDashboard();
    } else {
        showScreen('auth');
    }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    state.user = await api('/login', 'POST', { username, password });
    localStorage.setItem('collaboration_docs_user', JSON.stringify(state.user));
    initDashboard();
  } catch (err) {
    showAlert('Login failed: ' + err.message, 'error');
  }
});

document.getElementById('register-btn').addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    state.user = await api('/register', 'POST', { username, password });
    localStorage.setItem('collaboration_docs_user', JSON.stringify(state.user));
    initDashboard();
  } catch (err) {
    showAlert('Register failed: ' + err.message, 'error');
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  state.user = null;
  state.currentDoc = null;
  localStorage.removeItem('collaboration_docs_user');
  if (state.editor) state.editor.destroy();
  if (state.provider) state.provider.destroy();
  showScreen('auth');
});

// Dashboard
async function initDashboard() {
  showScreen('dashboard');
  document.getElementById('welcome-msg').innerText = `Hello, ${state.user.username}`;
  loadDocuments();
  
  // Setup socket listener for document sharing notifications
  if (state.socket) {
    state.socket.disconnect();
  }
  state.socket = io();
  state.socket.on('document-shared', (data) => {
    if (data.userId == state.user.id) {
      // Refresh document list when a document is shared with this user
      loadDocuments();
    }
  });
}

async function loadDocuments() {
  const list = document.getElementById('doc-list');
  list.innerHTML = 'Loading...';
  try {
    const docs = await api(`/documents?userId=${state.user.id}`);
    list.innerHTML = '';
    docs.forEach(doc => {
      const li = document.createElement('li');
      li.innerHTML = `
        <strong>${doc.name}</strong> (${doc.role}) 
        <button class="open-btn" data-id="${doc.id}" data-name="${doc.name}">Open</button>
        ${doc.role === 'owner' ? `<button class="delete-btn" data-id="${doc.id}" data-name="${doc.name}">Delete</button>` : ''}
      `;
      list.appendChild(li);
    });
    
    document.querySelectorAll('.open-btn').forEach(btn => {
      btn.addEventListener('click', () => openDocument(btn.dataset.id, btn.dataset.name));
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const confirmed = await showConfirm('Delete Document', `Delete "${btn.dataset.name}"? This cannot be undone.`);
        if (confirmed) {
          try {
            await api(`/documents/${btn.dataset.id}`, 'DELETE');
            loadDocuments();
            showAlert('Document deleted successfully', 'success');
          } catch (err) {
            showAlert('Delete failed: ' + err.message, 'error');
          }
        }
      });
    });
  } catch (err) {
    list.innerText = 'Error loading docs';
  }
}

document.getElementById('create-doc-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-doc-name').value;
  if (!name) return;
  try {
    await api('/documents', 'POST', { name, userId: state.user.id });
    document.getElementById('new-doc-name').value = '';
    loadDocuments();
    showAlert('Document created successfully', 'success');
  } catch (err) {
    showAlert(err.message, 'error');
  }
});

// Editor
async function openDocument(id, name) {
  state.currentDoc = { id, name };
  showScreen('editor');
  document.getElementById('doc-title').innerText = name;
  
  if (state.editor) state.editor.destroy();
  if (state.provider) state.provider.destroy();

  // Load Content first and get user's role
  let initialContent = '';
  let userRole = null;
  try {
      const res = await api(`/documents/${id}/content?userId=${state.user.id}`);
      initialContent = res.content || '';
      userRole = res.role || null;
      state.currentDocRole = userRole;
  } catch(err) {
      console.error("Failed to load content", err);
  }

  // Y.js provider (creates its own socket connection internally)
  const ydoc = new Y.Doc();
  
  // Provider
  state.provider = new SocketIOProvider('ws://localhost:3000', id, ydoc, {
    autoConnect: true,
  });

  // Tiptap CollaborationCursor relies on 'provider.awareness'.
  // If y-socket.io doesn't expose it correctly or immediately, we might need a workaround.
  // BUT the logs show state.provider.awareness.doc IS defined.
  // So why does Tiptap/ProseMirror fail?
  // Maybe it's a timing issue. 
  // Let's defer editor creation slightly or use a requestAnimationFrame.
  
  // Also, Collaboration extension also needs provider if we want it to handle YDoc?
  // No, Collaboration extension takes 'document' (Y.Doc) or 'fragment'.
  
  setTimeout(() => {
      const isReadOnly = userRole === 'reader';
      
      // Build extensions array - only add CollaborationCursor for non-readers
      const extensions = [
        StarterKit.configure({
          history: false, 
        }),
        Collaboration.configure({
          document: ydoc,
        }),
      ];
      
      // Only add cursor extension if user can edit
      if (!isReadOnly) {
        // Generate a bright, visible color for cursor
        const hue = Math.floor(Math.random() * 360);
        const saturation = 70 + Math.floor(Math.random() * 30); // 70-100%
        const lightness = 50 + Math.floor(Math.random() * 10); // 50-60%
        const cursorColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        
        extensions.push(CollaborationCursor.configure({
          provider: state.provider,
          user: {
            name: state.user.username,
            color: cursorColor
          },
        }));
      }
      
      state.editor = new Editor({
        element: document.querySelector('.editor'),
        editable: !isReadOnly,
        extensions: extensions,
    onUpdate: debounce(async ({ editor }) => {
        if (isReadOnly) return; // Don't save if read-only
        const content = editor.getHTML();
        try {
          await api(`/documents/${id}/save`, 'POST', { content, userId: state.user.id });
        } catch(err) {
          console.error('Autosave failed:', err);
        }
    }, 60000), // 1 minute debounce
      });
      
      // Hide toolbar and disable buttons for readers
      const menuBar = document.querySelector('.menu-bar');
      const saveBtn = document.getElementById('save-btn');
      const shareBtn = document.getElementById('share-btn');
      const historyBtn = document.getElementById('history-btn');
      
      if (isReadOnly) {
        // Hide toolbar completely
        if (menuBar) {
          menuBar.style.display = 'none';
        }
        // Hide save and share buttons
        if (saveBtn) {
          saveBtn.style.display = 'none';
        }
        if (shareBtn) {
          shareBtn.style.display = 'none';
        }
        // Keep history button visible but move it
        if (historyBtn) {
          historyBtn.style.display = 'inline-block';
        }
        // Make editor read-only
        const editorEl = document.querySelector('.editor');
        if (editorEl) {
          editorEl.style.cursor = 'default';
        }
      } else {
        // Show toolbar and buttons
        if (menuBar) {
          menuBar.style.display = 'flex';
        }
        if (saveBtn) {
          saveBtn.style.display = 'inline-block';
        }
        if (shareBtn) {
          shareBtn.style.display = 'inline-block';
        }
        if (historyBtn) {
          historyBtn.style.display = 'inline-block';
        }
        // Setup menu bar handlers
        setupMenuBar();
      }

      if (initialContent) {
          state.provider.on('sync', (isSynced) => {
              if (isSynced && ydoc.getText('default').length === 0 && initialContent) {
                 state.editor.commands.setContent(initialContent);
              }
          });
      }

      // Make the entire editor container clickable to focus (only for non-readers)
      if (!isReadOnly) {
        const editorElement = document.querySelector('.editor');
        editorElement.addEventListener('click', (e) => {
            // Focus the editor when clicking anywhere in the container (including padding)
            if (state.editor && !state.editor.isDestroyed) {
                state.editor.commands.focus();
            }
        });
      }
  }, 100);
}

// Menu Bar Setup
function setupMenuBar() {
  document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const level = btn.dataset.level;
      
      if (!state.editor) return;
      
      switch(action) {
        case 'bold':
          state.editor.chain().focus().toggleBold().run();
          break;
        case 'italic':
          state.editor.chain().focus().toggleItalic().run();
          break;
        case 'strike':
          state.editor.chain().focus().toggleStrike().run();
          break;
        case 'code':
          state.editor.chain().focus().toggleCode().run();
          break;
        case 'heading':
          state.editor.chain().focus().toggleHeading({ level: parseInt(level) }).run();
          break;
        case 'paragraph':
          state.editor.chain().focus().setParagraph().run();
          break;
        case 'bulletList':
          state.editor.chain().focus().toggleBulletList().run();
          break;
        case 'orderedList':
          state.editor.chain().focus().toggleOrderedList().run();
          break;
        case 'blockquote':
          state.editor.chain().focus().toggleBlockquote().run();
          break;
        case 'codeBlock':
          state.editor.chain().focus().toggleCodeBlock().run();
          break;
        case 'horizontalRule':
          state.editor.chain().focus().setHorizontalRule().run();
          break;
        case 'hardBreak':
          state.editor.chain().focus().setHardBreak().run();
          break;
        case 'undo':
          state.editor.chain().focus().undo().run();
          break;
        case 'redo':
          state.editor.chain().focus().redo().run();
          break;
      }
      
      // Update active states
      updateMenuBarState();
    });
  });
  
  // Update button states on editor update
  if (state.editor) {
    state.editor.on('selectionUpdate', updateMenuBarState);
    state.editor.on('update', updateMenuBarState);
  }
}

function updateMenuBarState() {
  if (!state.editor) return;
  
  document.querySelectorAll('.menu-btn').forEach(btn => {
    const action = btn.dataset.action;
    const level = btn.dataset.level;
    
    let isActive = false;
    
    switch(action) {
      case 'bold':
        isActive = state.editor.isActive('bold');
        break;
      case 'italic':
        isActive = state.editor.isActive('italic');
        break;
      case 'strike':
        isActive = state.editor.isActive('strike');
        break;
      case 'code':
        isActive = state.editor.isActive('code');
        break;
      case 'heading':
        isActive = state.editor.isActive('heading', { level: parseInt(level) });
        break;
      case 'paragraph':
        isActive = state.editor.isActive('paragraph');
        break;
      case 'bulletList':
        isActive = state.editor.isActive('bulletList');
        break;
      case 'orderedList':
        isActive = state.editor.isActive('orderedList');
        break;
      case 'blockquote':
        isActive = state.editor.isActive('blockquote');
        break;
      case 'codeBlock':
        isActive = state.editor.isActive('codeBlock');
        break;
    }
    
    if (isActive) {
      btn.classList.add('is-active');
    } else {
      btn.classList.remove('is-active');
    }
  });
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

document.getElementById('back-btn').addEventListener('click', () => {
  initDashboard();
});

document.getElementById('save-btn').addEventListener('click', async () => {
  if (state.editor && state.currentDoc) {
    if (state.currentDocRole === 'reader') {
      showAlert('You do not have permission to edit this document', 'error');
      return;
    }
    const content = state.editor.getHTML();
    try {
      await api(`/documents/${state.currentDoc.id}/save`, 'POST', { content, userId: state.user.id });
      showAlert('Document saved successfully', 'success');
    } catch(err) {
      showAlert('Save failed: ' + err.message, 'error');
    }
  }
});

// Sharing
document.getElementById('share-btn').addEventListener('click', () => {
    document.getElementById('share-modal').classList.remove('hidden');
});

document.querySelector('#share-modal .close').addEventListener('click', () => {
    document.getElementById('share-modal').classList.add('hidden');
});

document.getElementById('confirm-share').addEventListener('click', async () => {
    const username = document.getElementById('share-username').value;
    const role = document.getElementById('share-role').value;
    try {
        await api(`/documents/${state.currentDoc.id}/share`, 'POST', { username, role });
        document.getElementById('share-modal').classList.add('hidden');
        document.getElementById('share-username').value = '';
        showAlert('Document shared successfully', 'success');
    } catch(err) {
        showAlert(err.message, 'error');
    }
});

// History / Rollback
document.getElementById('history-btn').addEventListener('click', async () => {
    document.getElementById('history-modal').classList.remove('hidden');
    const list = document.getElementById('history-list');
    list.innerHTML = 'Loading...';
    try {
        const history = await api(`/documents/${state.currentDoc.id}/history`);
        list.innerHTML = '';
        
        if (history.length === 0) {
            list.innerHTML = '<li>No history available</li>';
            return;
        }
        
        history.forEach(commit => {
            const li = document.createElement('li');
            // Format date nicely
            const date = new Date(commit.date);
            const formattedDate = date.toLocaleString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            li.innerHTML = `
                <div class="history-item">
                    <div class="history-date">${formattedDate}</div>
                    <div class="history-message">${commit.message}</div>
                    <button class="rollback-btn" data-hash="${commit.hash}">Rollback to this version</button>
                </div>
            `;
            list.appendChild(li);
        });
        
        document.querySelectorAll('.rollback-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const confirmed = await showConfirm(
                    'Rollback Document', 
                    'Are you sure you want to rollback to this version? This will restore the document to this state. You can undo this rollback later if needed.'
                );
                if(confirmed) {
                    try {
                        await api(`/documents/${state.currentDoc.id}/rollback`, 'POST', { hash: btn.dataset.hash });
                        
                        // Close the modal
                        document.getElementById('history-modal').classList.add('hidden');
                        
                        // Fetch the rolled-back content from the server
                        const res = await api(`/documents/${state.currentDoc.id}/content?userId=${state.user.id}`);
                        const newContent = res.content || '';
                        
                        // Update the editor with the new content
                        if (state.editor) {
                            state.editor.commands.setContent(newContent);
                        }
                        
                        showAlert('Document rolled back successfully', 'success');
                    } catch(err) {
                        showAlert('Rollback failed: ' + err.message, 'error');
                    }
                }
            });
        });
    } catch(err) {
        list.innerText = 'Error loading history';
        console.error(err);
    }
});

document.querySelector('#history-modal .close').addEventListener('click', () => {
    document.getElementById('history-modal').classList.add('hidden');
});

// Start
checkAuth();
