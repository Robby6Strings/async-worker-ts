import { isMainThread, workerData, parentPort } from "node:worker_threads"
import type { WorkerParentMessage } from "./types"
import {
  deserializeProcMap,
  getProc,
  getProcMapScope,
  createTaskScope,
} from "./worker-shared.js"

if (!isMainThread && parentPort) {
  const procMap = deserializeProcMap(workerData)
  const postMessage = (data: any) => parentPort?.postMessage({ data })

  parentPort.on("message", async (e: WorkerParentMessage) => {
    if (!("path" in e)) return
    const { id, path, args, isTask } = e

    const scope = isTask
      ? createTaskScope(
          postMessage,
          (event: string, handler: any) =>
            parentPort!.removeListener(event, handler),
          (event: string, handler: any) =>
            parentPort!.addListener(event, handler)
        )
      : path.includes(".")
      ? getProcMapScope(procMap, path)
      : procMap

    try {
      const result = await getProc(procMap, path).bind(scope)(...args)
      postMessage({ id, result })
    } catch (error) {
      postMessage({ id, error })
    }
  })
}
