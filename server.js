const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const basicAuth = require('express-basic-auth');
const { init, seedIfEmpty } = require('./db');
const routes = require('./routes');

const PORT = process.env.PORT || 3002;
const db = init();
seedIfEmpty();

const app = express();
app.set('trust proxy', 1);
app.use(compression());

// Security headers
app.use(helmet({
  contentSecurityPolicy: false
}));

// Rate limiting — 200 req/min per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

// Basic authentication
app.use(basicAuth({
  users: { 'focus': 'flooring2026' },
  challenge: true,
  realm: 'SPD Proposal Generator'
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(routes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SPD Proposal Generator listening on port ${PORT}`);
});
