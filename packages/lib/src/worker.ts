import type { IProcMap, ISerializedProcMap, WorkerParentMessage } from "./types"

let didInit = false
let procMap: IProcMap = {}
let generatedFnMap: { [key: string]: string } = {}

onmessage = async (e) => {
  if (!e.data) return
  if (!didInit) {
    procMap = deserializeProcMap(e.data)
    didInit = true
    postMessage("initialized")
    return
  }

  const {
    id,
    path,
    args,
    //_result
  } = e.data as WorkerParentMessage
  if ("yield" in e.data) return
  if ("result" in e.data) return

  let scope = procMap
  if (path === undefined) debugger
  if (path.includes(".")) {
    const keys = path.split(".")
    keys.pop()
    // @ts-ignore
    scope = keys.reduce((acc, key) => acc[key], procMap)
  }

  try {
    // @ts-expect-error
    globalThis.reportProgress = (progress: number) =>
      postMessage({ id, progress })

    // @ts-expect-error
    globalThis._____yield = async (value: any) => {
      postMessage({ id, yield: value })

      return new Promise((resolve) => {
        const handler = async (event: MessageEvent) => {
          if (!("yield" in event.data) && !("result" in event.data)) return
          const { id: responseId, yield: yieldInputValue, result } = event.data
          if (responseId !== id) return

          removeEventListener("message", handler)
          if ("result" in event.data) return resolve(result)
          resolve(yieldInputValue)
        }

        addEventListener("message", handler)
      })
    }

    let fn = getProc(path)
    const toStringTag = (fn as any)[Symbol.toStringTag]
    const isGenerator = toStringTag?.endsWith("GeneratorFunction")

    if (isGenerator) {
      const genSrc =
        generatedFnMap[path] ??
        (generatedFnMap[path] = customGenerator(fn.toString()))

      let gfn = eval(`(${genSrc})`) as (...args: any[]) => any
      fn = gfn
    }

    const result = await fn.bind(scope)(...args)
    postMessage({ id, result })
  } catch (error) {
    postMessage({ id, error })
  }
}

function customGenerator(sourceCode: string) {
  const yieldRegex = /yield\s+([^;\n]+)(?=[;\n])/g // Regex to find 'yield' statements
  let newSrc = nameFunc(sourceCode)
  if (newSrc.substring(0, "async ".length) !== "async ") {
    newSrc = `async ${newSrc}`
  }
  if (newSrc.startsWith("async function*")) {
    newSrc = newSrc.replace("async function*", "async function")
  }
  let match
  while ((match = yieldRegex.exec(newSrc)) !== null) {
    // Extract values from the 'yield' statements
    const offset = match.index
    const len = match[0].length
    const value = match[1]

    newSrc =
      newSrc.slice(0, offset) +
      `await _____yield(${value})` +
      newSrc.slice(offset + len, newSrc.length)
  }

  return newSrc
}

function getProc(path: string) {
  const keys = path.split(".") as string[]
  let map = procMap as any

  while (keys.length) {
    const k = keys.shift()!
    if (!map[k]) throw new Error(`No procedure found: "${path}"`)
    map = map[k]
    if (typeof map === "function") return map as { (...args: any): any }
  }

  throw new Error(`No procedure found: "${path}"`)
}

function deserializeProcMap(procMap: ISerializedProcMap) {
  return Object.entries(procMap).reduce((acc, [key, value]) => {
    acc[key] =
      typeof value === "string" ? parseFunc(value) : deserializeProcMap(value)
    return acc
  }, {} as IProcMap)
}
// prettier-ignore
function parseFunc(str: string): (...args: any[]) => any {
  str = nameFunc(str)
  return eval(`(${str})`)
}

function nameFunc(str: string) {
  const unnamedFunc = "function("
  const unnamedGeneratorFunc = "function*("
  const unnamedAsyncFunc = "async function("
  const unnamedAsyncGeneratorFunc = "async function*("
  str = str.trim()

  const fn_name_internal = "___thunk___"

  if (str.startsWith("function (")) str = str.replace("function (", unnamedFunc)
  if (str.startsWith("async function ("))
    str = str.replace("async function (", unnamedAsyncFunc)
  if (str.startsWith("function* ("))
    str = str.replace("function* (", unnamedGeneratorFunc)
  if (str.startsWith("async function* ("))
    str = str.replace("async function* (", unnamedAsyncGeneratorFunc)

  if (str.startsWith(unnamedFunc))
    return str.replace(unnamedFunc, `function ${fn_name_internal}(`)
  if (str.startsWith(unnamedAsyncFunc))
    return str.replace(unnamedAsyncFunc, `async function ${fn_name_internal}(`)
  if (str.startsWith(unnamedGeneratorFunc))
    return str.replace(unnamedGeneratorFunc, `function* ${fn_name_internal}(`)
  if (str.startsWith(unnamedAsyncGeneratorFunc))
    return str.replace(
      unnamedAsyncGeneratorFunc,
      `async function* ${fn_name_internal}(`
    )
  return str
}
