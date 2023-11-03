import {
  isMainThread,
  workerData,
  parentPort,
  MessagePort,
} from "node:worker_threads"

if (!isMainThread && parentPort) {
  const procMap = deserializeProcMap(workerData)
  parentPort.on("message", async ({ id, key, args }) => {
    const pp = parentPort as MessagePort
    try {
      const result = await procMap[key](...args)
      pp.postMessage({ id, result })
    } catch (error) {
      pp.postMessage({ id, error })
    }
  })
}

function deserializeProcMap(serializedProcMap: Record<string, string>) {
  return Object.entries(serializedProcMap).reduce((acc, [key, value]) => {
    acc[key] = eval(`(${value})`)
    return acc
  }, {} as Record<string, (...args: any[]) => Promise<any>>)
}