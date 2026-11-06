const { MongoClient, ObjectId } = require('mongodb');

let db;
let connectionPromise;

async function connect() {
  if (db) return db;
  if (connectionPromise) return connectionPromise;

  const client = new MongoClient(process.env.MONGODB_URI);
  connectionPromise = (async () => {
    try {
      await client.connect();
      const database = client.db(process.env.MONGODB_DB || 'tgforward');
      await database.collection('users').createIndex({ email: 1 }, { unique: true });
      await database.collection('users').createIndex({ emailVerificationTokenHash: 1 }, { unique: true, sparse: true });
      await database.collection('users').createIndex({ passwordResetTokenHash: 1 }, { unique: true, sparse: true });
      await database.collection('channels').createIndex({ userId: 1, chatId: 1, role: 1 }, { unique: true });
      await database.collection('channels').createIndex({ chatId: 1, role: 1, enabled: 1 });
      await database.collection('channels').createIndex({ userId: 1, sourceId: 1, role: 1, enabled: 1 });
      await database.collection('sourceBlocklist').createIndex({ chatId: 1 }, { unique: true });
      await database.collection('channelReports').createIndex({ status: 1, createdAt: -1 });
      await database.collection('channelReports').createIndex({ chatId: 1, createdAt: -1 });
      await database.collection('channelReports').createIndex({ chatId: 1, reporterUserId: 1, status: 1 });
      await database.collection('promotions').createIndex({ userId: 1, sourceId: 1, enabled: 1 });
      await database.collection('logs').createIndex({ userId: 1, createdAt: -1 });
      await database.collection('logs').createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
      db = database;
      console.log('MongoDB connected');
      return db;
    } catch (err) {
      await client.close().catch(() => {});
      connectionPromise = null;
      throw err;
    }
  })();

  return connectionPromise;
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
