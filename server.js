const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize SQLite Database
const db = new Database(path.join(__dirname, 'tickets.db'));

// Create tables if they don't exist
function initDatabase() {
    // Create steps table
    db.exec(`
        CREATE TABLE IF NOT EXISTS steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Create tickets table
    db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_number INTEGER NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT 'white',
            notes TEXT,
            current_step_id INTEGER,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (current_step_id) REFERENCES steps(id) ON DELETE SET NULL
        )
    `);

    // Ensure order_index exists (for existing DBs)
    try {
        const cols = db.prepare("PRAGMA table_info(tickets)").all();
        const hasOrder = cols.some(c => c.name === 'order_index');
        if (!hasOrder) {
            db.exec("ALTER TABLE tickets ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0");
            // Initialize order_index sequentially by ticket_number
            const all = db.prepare('SELECT id FROM tickets ORDER BY ticket_number ASC').all();
            const update = db.prepare('UPDATE tickets SET order_index = ? WHERE id = ?');
            let idx = 0;
            for (const row of all) update.run(idx++, row.id);
        }
    } catch (e) {
        // ignore
    }
    
    console.log('Database initialized successfully');
}

initDatabase();

// =====================
// TICKETS API ENDPOINTS
// =====================

// Get all tickets
app.get('/api/tickets', (req, res) => {
    try {
        const tickets = db.prepare('SELECT * FROM tickets ORDER BY order_index ASC, ticket_number ASC').all();
        res.json(tickets);
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});

// Get single ticket
app.get('/api/tickets/:id', (req, res) => {
    try {
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }
        res.json(ticket);
    } catch (error) {
        console.error('Error fetching ticket:', error);
        res.status(500).json({ error: 'Failed to fetch ticket' });
    }
});

// Create new ticket
app.post('/api/tickets', (req, res) => {
    try {
        const { ticket_number, color, notes, current_step_id, order_index } = req.body;

        // Determine next order_index if not provided
        let idx = order_index;
        if (typeof idx !== 'number') {
            const row = db.prepare('SELECT MAX(order_index) as m FROM tickets').get();
            idx = (row?.m ?? -1) + 1;
        }
        
        const stmt = db.prepare(`
            INSERT INTO tickets (ticket_number, color, notes, current_step_id, order_index)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
            ticket_number,
            color || 'white',
            notes || '',
            current_step_id || null,
            idx
        );
        
        const newTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newTicket);
    } catch (error) {
        console.error('Error creating ticket:', error);
        res.status(500).json({ error: 'Failed to create ticket' });
    }
});

// Update ticket
app.put('/api/tickets/:id', (req, res) => {
    try {
        const { color, notes, current_step_id, ticket_number, order_index } = req.body;
        const updates = [];
        const values = [];
        
        if (color !== undefined) {
            updates.push('color = ?');
            values.push(color);
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            values.push(notes);
        }
        if (current_step_id !== undefined) {
            updates.push('current_step_id = ?');
            values.push(current_step_id);
        }
        if (ticket_number !== undefined) {
            updates.push('ticket_number = ?');
            values.push(ticket_number);
        }
        if (order_index !== undefined) {
            updates.push('order_index = ?');
            values.push(order_index);
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.params.id);
        
        const stmt = db.prepare(`
            UPDATE tickets 
            SET ${updates.join(', ')}
            WHERE id = ?
        `);
        
        stmt.run(...values);
        
        const updatedTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
        res.json(updatedTicket);
    } catch (error) {
        console.error('Error updating ticket:', error);
        res.status(500).json({ error: 'Failed to update ticket' });
    }
});

// Delete ticket
app.delete('/api/tickets/:id', (req, res) => {
    try {
        const stmt = db.prepare('DELETE FROM tickets WHERE id = ?');
        const result = stmt.run(req.params.id);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Ticket not found' });
        }
        
        res.json({ message: 'Ticket deleted successfully' });
    } catch (error) {
        console.error('Error deleting ticket:', error);
        res.status(500).json({ error: 'Failed to delete ticket' });
    }
});

// ===================
// STEPS API ENDPOINTS
// ===================

// Get all steps
app.get('/api/steps', (req, res) => {
    try {
        const steps = db.prepare('SELECT * FROM steps ORDER BY order_index ASC').all();
        res.json(steps);
    } catch (error) {
        console.error('Error fetching steps:', error);
        res.status(500).json({ error: 'Failed to fetch steps' });
    }
});

// Get single step
app.get('/api/steps/:id', (req, res) => {
    try {
        const step = db.prepare('SELECT * FROM steps WHERE id = ?').get(req.params.id);
        if (!step) {
            return res.status(404).json({ error: 'Step not found' });
        }
        res.json(step);
    } catch (error) {
        console.error('Error fetching step:', error);
        res.status(500).json({ error: 'Failed to fetch step' });
    }
});

// Create new step
app.post('/api/steps', (req, res) => {
    try {
        const { name, order_index } = req.body;
        
        const stmt = db.prepare(`
            INSERT INTO steps (name, order_index)
            VALUES (?, ?)
        `);
        
        const result = stmt.run(name, order_index || 0);
        
        const newStep = db.prepare('SELECT * FROM steps WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newStep);
    } catch (error) {
        console.error('Error creating step:', error);
        res.status(500).json({ error: 'Failed to create step' });
    }
});

// Update step
app.put('/api/steps/:id', (req, res) => {
    try {
        const { name, order_index } = req.body;
        const updates = [];
        const values = [];
        
        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (order_index !== undefined) {
            updates.push('order_index = ?');
            values.push(order_index);
        }
        
        values.push(req.params.id);
        
        const stmt = db.prepare(`
            UPDATE steps 
            SET ${updates.join(', ')}
            WHERE id = ?
        `);
        
        stmt.run(...values);
        
        const updatedStep = db.prepare('SELECT * FROM steps WHERE id = ?').get(req.params.id);
        res.json(updatedStep);
    } catch (error) {
        console.error('Error updating step:', error);
        res.status(500).json({ error: 'Failed to update step' });
    }
});

// Delete step
app.delete('/api/steps/:id', (req, res) => {
    try {
        // First, set current_step_id to NULL for any tickets using this step
        db.prepare('UPDATE tickets SET current_step_id = NULL WHERE current_step_id = ?').run(req.params.id);
        
        // Then delete the step
        const stmt = db.prepare('DELETE FROM steps WHERE id = ?');
        const result = stmt.run(req.params.id);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Step not found' });
        }
        
        res.json({ message: 'Step deleted successfully' });
    } catch (error) {
        console.error('Error deleting step:', error);
        res.status(500).json({ error: 'Failed to delete step' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API available at http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    console.log('\nDatabase connection closed');
    process.exit(0);
});
