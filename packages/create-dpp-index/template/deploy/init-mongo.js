// Runs only for a new MongoDB volume. The index gets one database's read/write role.
db.getSiblingDB(process.env.MONGO_DB).createUser({
  user: 'dpp_index',
  pwd: process.env.MONGO_INDEX_PASSWORD,
  roles: [{ role: 'readWrite', db: process.env.MONGO_DB }],
})
