# Structure preview

Full-screen preview for one structure JSON file. The chat panel, project list, and session API are not part of this copy.

Do not install or start this directory in place. Copy it to `<workspace>/minecraft-viewer` (skip `node_modules` and `dist`), then install and start the copy:

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

The preview URL is `http://127.0.0.1:<port>/?file=<absolute JSON path>`. Use forward slashes and encode the path. The page rewrites a disk path such as `C:/builds/house.json` to Vite's `/@fs/` route and loads it. Dropping a file onto the page still works. The JSON is either the structure itself or a runner result with a `structure` field. Each block has inclusive `start`, exclusive `end`, `type`, `properties`, and `fill`.
