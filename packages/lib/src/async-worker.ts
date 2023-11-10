import { OmniWorker } from "./omniworker.js"
import { Task } from "./task.js"
import type { IProcMap, ISerializedProcMap, ProcedurePromise } from "./types.js"

export class AsyncWorker {
  private serializedProcMap: ISerializedProcMap
  private worker: OmniWorker | undefined = undefined
  private completionCallbacks: { [taskId: string]: (() => void)[] } = {}

  constructor(procMap: IProcMap) {
    this.serializedProcMap = serializeProcMap(procMap)
  }

  public call(
    path: string,
    isTask: boolean,
    ...args: unknown[]
  ): ProcedurePromise<unknown> {
    const taskId = crypto.randomUUID()
    const wp = this.getWorker()

    const promise = new Promise(async (resolve, reject) => {
      const worker = await wp
      const handler = (event: MessageEvent) => {
        if ("generator" in event.data) {
          return resolve(
            (async function* (...next: any[]) {
              while (true) {
                const { value, done } = await new Promise<any>((res) => {
                  const handler = (event: MessageEvent) => {
                    if (!("yield" in event.data)) return
                    const { id: responseId, yield: yieldRes, done } = event.data

                    if (responseId !== taskId) return

                    res({ value: yieldRes, done })
                  }

                  worker.addEventListener("message", handler)
                  worker.postMessage({ id: taskId, next })
                })

                if (done) {
                  worker.removeEventListener("message", handler)
                  return value
                }
                next = yield value
              }
            })(...args)
          )
        }

        if (!("result" in event.data)) return
        const { id: responseId, result, error } = event.data
        if (responseId === taskId) {
          worker.removeEventListener("message", handler)
          if (this.completionCallbacks[taskId]) {
            this.completionCallbacks[taskId].forEach((cb) => cb())
            delete this.completionCallbacks[taskId]
          }

          return error ? reject(error) : resolve(result)
        }
      }
      worker.addEventListener("message", handler)
      worker.postMessage({ id: taskId, path, args, isTask })
    }) as Partial<ProcedurePromise<unknown>>

    return Object.assign(promise, {
      on: async (event: string, callback: (data?: any) => any) => {
        const emitHandler = async (e: MessageEvent) => {
          if (!("event" in e.data)) return
          const { id: msgId, event: taskEvent, data } = e.data
          if (taskEvent !== event) return
          const res = callback(data)
          if (res instanceof Promise) await res
          wp.then(async (w) => w.postMessage({ id: msgId, data: res }))
        }

        wp.then((worker) => {
          worker.addEventListener("message", emitHandler)
          if (!this.completionCallbacks[taskId])
            this.completionCallbacks[taskId] = []

          this.completionCallbacks[taskId].push(() =>
            worker.removeEventListener("message", emitHandler)
          )
        })
        return promise as ProcedurePromise<unknown>
      },
    }) as ProcedurePromise<unknown>
  }

  private async getWorker(): Promise<OmniWorker> {
    if (!this.worker) {
      this.worker = await OmniWorker.new(this.serializedProcMap)
    }
    return this.worker
  }

  public async exit(): Promise<void> {
    if (this.worker) await this.worker.terminate()
    this.worker = undefined
  }
}

function serializeProcMap(map: IProcMap): ISerializedProcMap {
  return Object.entries(map).reduce(
    (acc, [key, value]) =>
      Object.assign(acc, {
        [key]:
          typeof value === "function"
            ? value.toString()
            : value instanceof Task
            ? Task.getTaskFn(value).toString()
            : serializeProcMap(value),
      }),
    {}
  )
}
