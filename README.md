# Ticket Manager

Lightweight ticket manager with a sliding color picker and SQLite persistence.

## Quick start

1) Install and run
```bash
npm install
npm start
```
Open http://localhost:3000

2) Add tickets
- Click the + button (bottom-right)

3) Color picker (top-right of each ticket)
- Hover to expand: [+] Hot Pink, Orange, Yellow, Blue, then the selected circle on the far right
- Hover preview; Click to persist
- While expanded, ticket drag is disabled; it auto-collapses after ~2s
- Selected circle is slightly larger with dark-grey dual-arc outline and a short pulse on selection

4) Steps
- Configure steps in Settings; ticket step and notes persist to SQLite

## Tech
- Frontend: HTML, CSS, JS, Bootstrap 5
- Backend: Node.js + Express
- DB: SQLite (better-sqlite3)

## License
MIT
