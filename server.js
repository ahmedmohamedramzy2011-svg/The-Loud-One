const express = require('express');
const path = require('path');
const iceHandler = require('./api/ice');
const roomsHandler = require('./api/rooms');

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

app.get('/api/ice', iceHandler);
app.use('/api/rooms', express.json({ limit: '16kb' }), roomsHandler);

app.get(['/testing', '/testing/', '/testing.html'], (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use(express.static(path.join(__dirname), staticOpts));
app.use('/testing', express.static(path.join(__dirname, 'public'), Object.assign({ redirect: false }, staticOpts)));
app.use('/testing', express.static(path.join(__dirname), Object.assign({ redirect: false }, staticOpts)));

app.get('*', (req, res) => {
  if (/^\/(assets|public|js|css|audio)\//i.test(req.path) || /\.[a-z0-9]{1,8}$/i.test(req.path)) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
