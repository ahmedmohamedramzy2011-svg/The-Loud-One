const express = require('express');
const path = require('path');
const iceHandler = require('./api/ice');
const roomsHandler = require('./api/rooms');
const adminAuthHandler = require('./api/admin-auth');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

const staticOpts = {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
};

// Explicitly reject /testing routes with 404 so scanners cannot reach any testing surface
app.all(/^\/testing(\/.*|\.html)?$/i, (req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

app.get('/api/ice', iceHandler);
app.use('/api/rooms', express.json({ limit: '16kb' }), roomsHandler);
app.use('/api/admin-auth', express.json({ limit: '8kb' }), adminAuthHandler);

app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use(express.static(path.join(__dirname), staticOpts));

app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
