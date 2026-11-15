// The database half of the rehearsal shell in `mongo-shell.ts`. It holds the
// connection and answers one request at a time, so the thread that runs a
// documentation block can wait for each answer as a database shell does.
import { workerData } from 'node:worker_threads'
import { BSON, MongoClient } from 'mongodb'

const { uri, database, signal, port } = workerData
const flag = new Int32Array(signal)
const client = new MongoClient(uri)
const connected = client.connect()

/** Every call the documented commands make. A call that is not here is refused by name, so a new one cannot run untested. */
const operations = {
  find: (collection, { filter, projection, sort }) => {
    const cursor = collection.find(filter ?? {}, projection == null ? {} : { projection })
    return (sort == null ? cursor : cursor.sort(sort)).toArray()
  },
  aggregate: (collection, { pipeline }) => collection.aggregate(pipeline).toArray(),
  distinct: (collection, { field, filter }) => collection.distinct(field, filter ?? {}),
  countDocuments: (collection, { filter }) => collection.countDocuments(filter ?? {}),
  deleteMany: async (collection, { filter }) => {
    const { acknowledged, deletedCount } = await collection.deleteMany(filter)
    return { acknowledged, deletedCount }
  },
}

port.on('message', async (request) => {
  let reply
  try {
    await connected
    if (request.op === 'close') {
      await client.close()
      reply = { ok: true, value: null }
    } else {
      const operation = operations[request.op]
      if (operation == null) throw new Error(`the rehearsal shell has no operation ${request.op}`)
      // Plain JSON on the way back: a documented command reads strings, numbers and counts, never a driver type.
      reply = { ok: true, value: BSON.EJSON.serialize(await operation(client.db(database).collection(request.collection), request)) }
    }
  } catch (cause) {
    reply = { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
  }
  // The answer first, then the signal, so the waiting thread always finds the answer already delivered.
  port.postMessage(reply)
  Atomics.store(flag, 0, 1)
  Atomics.notify(flag, 0)
})
