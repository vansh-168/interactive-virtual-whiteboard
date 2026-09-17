# Interactive Virtual Whiteboard

A multi-user real-time whiteboard. Draw shapes, write text, and move sticky notes — everyone connected sees changes live.

## Features

- Shapes: rectangle, ellipse, line, freehand pen
- Text boxes and draggable sticky notes
- Real-time sync across all connected clients via Socket.IO
- Anonymous join with a display name and an auto-assigned color
- Live presence list and labeled remote cursors

## Tech stack

- Frontend: HTML5 Canvas via [Fabric.js](http://fabricjs.com/) (plain JS, no framework)
- Backend: Node.js + Express + Socket.IO
- State: in-memory only (no database) — board resets when the server restarts

## Getting started

```bash
npm install
npm start        # or: npm run dev (auto-restarts on file changes)
```

Then open `http://localhost:3000` in multiple browser tabs/windows to try it with several users.

## Project structure

```
server.js            Express + Socket.IO server, in-memory board state
public/
  index.html          App shell: join modal, toolbar, canvas
  style.css           Styling
  client.js           Fabric.js canvas logic + Socket.IO client
```

## Notes / scope

This is an MVP: state is in-memory (no persistence/database), there's no login/auth (name + color only), and it's a single shared board (no separate rooms). These would be natural next steps to extend the project.
