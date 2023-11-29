import thingWorker from "./thing.worker.js"

//Demonstration of workers implementation.
async function main() {
  const thing1 = await thingWorker.doTheThing()
  console.log(thing1)
  const thing2 = await thingWorker.doTheOtherThing()
  console.log(thing2)
  const thing3 = await thingWorker.doAnotherThing(1)
  console.log(thing3)
  await thingWorker.exit()
}

main()
