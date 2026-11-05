const { MongoClient, ObjectId } = require('mongodb');

let db;

async function connect() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'tgforward');
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('channels').createIndex({ userId: 1, chatId: 1, role: 1 }, { unique: true });
  await db.collection('channels').createIndex({ chatId: 1, role: 1, enabled: 1 });
  await db.collection('channels').createIndex({ userId: 1, sourceId: 1, role: 1, enabled: 1 });
  await db.collection('promotions').createIndex({ userId: 1, sourceId: 1, enabled: 1 });
  await db.collection('logs').createIndex({ userId: 1, createdAt: -1 });
  // logs 30 din baad auto delete
  await db.collection('logs').createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
  console.log('MongoDB connected');
  return db;
}

const col = (name) => db.collection(name);

function oid(id) {
  try {
    return new ObjectId(String(id));
  } catch {
    return null;
  }
}

module.exports = { connect, col, oid };
