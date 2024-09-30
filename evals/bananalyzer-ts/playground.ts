import { evaluateExample } from ".";

async function test() {
  const singleExampleId = "JNOSAEEZO4j2unWHPFBdO";

  await evaluateExample(singleExampleId)
    .then((result) => console.log("Evaluation result:", result))
    .catch((error) => console.error("Evaluation error:", error));
}

test();
