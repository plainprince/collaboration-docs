const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'collaboration-docs.db');
const db = new sqlite3.Database(dbPath);

module.exports = {
  query: (text, params = []) => {
    return new Promise((resolve, reject) => {
      // Convert $1, $2 to ? for SQLite
      const sql = text.replace(/\$\d+/g, '?');
      
      // Determine execution method
      // If it contains RETURNING or starts with SELECT, use .all()
      if (text.trim().toUpperCase().startsWith('SELECT') || /RETURNING/i.test(text)) {
        db.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve({ rows });
        });
      } else {
        db.run(sql, params, function(err) {
          if (err) return reject(err);
          // Return an object that mimics pg result to some extent
          // For INSERT without RETURNING, pg returns rowCount
          resolve({ rows: [], rowCount: this.changes, lastID: this.lastID });
        });
      }
    });
  },
  close: () => db.close()
};
