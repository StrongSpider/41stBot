const { PORTAL_PORT, PORTAL_CORS_PORT, PORTAL_SECRET } = require('../../config.json');
const session = require('express-session');
const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const path = require("path");
const fs = require("fs");

// Express setup
const app = express();

app.use(session({
    secret: PORTAL_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }       // set true if you serve over https
}));

app.use(bodyParser.json({ limit: '50mb' }));

app.use(cors({
    origin: 'http://localhost:' + PORTAL_CORS_PORT,
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));

// React app setup will be registered after API routes to ensure precedence

// Routing setup
const routingPath = path.join(__dirname, 'routing');
const routingFolders = fs.readdirSync(routingPath)

function loadRoutesFromFolder(folderPath) {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(folderPath, entry.name);

        if (entry.isDirectory()) {
            // Recursively load routes from subfolders
            loadRoutesFromFolder(entryPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            // Load and use the router file
            const fileRouter = require(entryPath);
            app.use(fileRouter);
        }
    }
}

for (const folder of routingFolders) {
    if (folder === "util") continue; // Skip utility folder
    const folderPath = path.join(routingPath, folder);
    loadRoutesFromFolder(folderPath);
}


// React app setup
if (process.env.NODE_ENV === 'development') {
    (async () => {
        const { createServer } = await import('vite');
        const vite = await createServer({
            root: path.resolve(__dirname, 'website'),
            server: {
                middlewareMode: true,
                host: true,
                allowedHosts: true,
                fs: {
                    allow: [path.resolve(__dirname)]
                }
            },
            appType: 'custom'
        });
        app.use(vite.middlewares);
        app.use(async (req, res, next) => {
            if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
                return next();
            }
            const url = req.originalUrl;
            try {
                let template = fs.readFileSync(path.resolve(__dirname, 'website', 'index.html'), 'utf-8');
                template = await vite.transformIndexHtml(url, template);
                res.status(200).set({ 'Content-Type': 'text/html' }).send(template);
            } catch (e) {
                next(e);
            }
        });
    })();
} else {
    app.use(express.static(path.join(__dirname, 'website', 'dist')));
    app.use((req, res) => {
        res.sendFile(path.join(__dirname, 'website', 'dist', 'index.html'));
    });
}


app.listen(PORTAL_PORT, "192.168.1.100", () => {
    console.log(`App listening on port ${PORTAL_PORT}.`);
});