const fetch = require('node-fetch');

async function testFetch() {
  try {
    const res = await fetch('http://localhost:5000/api/get-turn-credentials');
    const data = await res.json();
    console.log("Success:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
testFetch();
