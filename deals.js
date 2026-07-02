import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DEALS_FILE = path.join(process.cwd(), 'deals-data', 'deals.json');

function ensureDir() {
  const dir = path.dirname(DEALS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(DEALS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DEALS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function save(deals) {
  ensureDir();
  fs.writeFileSync(DEALS_FILE, JSON.stringify(deals, null, 2));
}

export function createDeal({ buyer, seller, amount, coinId, description }) {
  const deals = load();
  const id = randomUUID().slice(0, 8);
  const deal = {
    id,
    buyer,
    seller,
    amount,
    coinId,
    description: description || '',
    status: 'pending',
    releaseVotes: [],
    refundVotes: [],
    createdAt: Date.now(),
    fundedAt: null,
    closedAt: null,
  };
  deals[id] = deal;
  save(deals);
  return deal;
}

export function getDeal(id) {
  const deals = load();
  return deals[id] || null;
}

export function listDeals() {
  const deals = load();
  return Object.values(deals);
}

export function updateDeal(id, patch) {
  const deals = load();
  if (!deals[id]) return null;
  deals[id] = { ...deals[id], ...patch };
  save(deals);
  return deals[id];
}

export function markFunded(id) {
  return updateDeal(id, { status: 'funded', fundedAt: Date.now() });
}

export function addReleaseVote(id, nametag) {
  const deal = getDeal(id);
  if (!deal) return null;
  const votes = new Set(deal.releaseVotes);
  votes.add(nametag);
  return updateDeal(id, { releaseVotes: [...votes] });
}

export function addRefundVote(id, nametag) {
  const deal = getDeal(id);
  if (!deal) return null;
  const votes = new Set(deal.refundVotes);
  votes.add(nametag);
  return updateDeal(id, { refundVotes: [...votes] });
}

export function closeDeal(id, status) {
  return updateDeal(id, { status, closedAt: Date.now() });
}
