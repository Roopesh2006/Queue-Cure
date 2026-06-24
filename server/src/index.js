import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { QueueManager } from './queue/QueueManager.js';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL } });
const queue = new QueueManager();

app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

await queue.loadFromRedis();

app.get('/healthz', (req, res) => res.sendStatus(200));

app.get('/api/queue', (req, res) => res.json(queue.getState()));

app.post('/api/queue/add', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name required' });
  }
  const patient = queue.addPatient(name);
  io.emit('queue:update', queue.getState());
  res.json(patient);
});

app.post('/api/verify-pin', (req, res) => {
  const pin = req.headers['x-receptionist-pin'];
  if (pin !== process.env.RECEPTIONIST_PIN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ ok: true });
});

app.post('/api/queue/next', async (req, res) => {
  const pin = req.headers['x-receptionist-pin'];
  if (pin !== process.env.RECEPTIONIST_PIN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (queue.isEmpty()) {
    return res.status(400).json({ error: 'Queue is empty' });
  }
  queue.callNext();
  const state = queue.getState();
  io.emit('queue:update', state);
  res.json(state);
});

app.post('/api/queue/seed', async (req, res) => {
  const { avgMin } = req.body;
  const parsed = parseFloat(avgMin);
  if (!parsed || parsed <= 0) {
    return res.status(400).json({ error: 'avgMin must be a positive number' });
  }
  await queue.setSeedAvg(parsed * 60 * 1000);
  io.emit('queue:update', queue.getState());
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.emit('queue:update', queue.getState());
});

httpServer.listen(process.env.PORT || 3001, () =>
  console.log(`Server running on port ${process.env.PORT || 3001}`)
);
