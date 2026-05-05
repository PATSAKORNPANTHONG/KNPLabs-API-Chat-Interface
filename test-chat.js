async function test() {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 6000);
  try {
     const res = await fetch("https://api.knplabai.com/v1/models", { signal: controller.signal });
     console.log("v1/models:", res.status, await res.text());
  } catch (e) {
     console.log("v1/models ERROR:", e.message);
  }
  clearTimeout(id);

  const controller2 = new AbortController();
  const id2 = setTimeout(() => controller2.abort(), 6000);
  try {
     const res2 = await fetch("https://api.knplabai.com/ai/v1/models", { signal: controller2.signal });
     console.log("ai/v1/models:", res2.status, await res2.text());
  } catch (e) {
     console.log("ai/v1/models ERROR:", e.message);
  }
  clearTimeout(id2);
}

test();
