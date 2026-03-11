const fetch = require('node-fetch');

async function testFetch() {
  try {
    const res = await fetch('https://theqnew.metered.live/api/v1/turn/credentials?apiKey=d185a98a85a4ff5d1b26b57bd6389e12574d');
    const data = await res.json();
    console.log("Success:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
testFetch();
