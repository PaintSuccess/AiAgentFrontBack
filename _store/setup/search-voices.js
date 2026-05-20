import "dotenv/config";

const API_KEY = process.env.ELEVENLABS_API_KEY;

async function searchVoices() {
  // Search for Australian voices
  const res = await fetch(
    "https://api.elevenlabs.io/v1/voices?show_legacy=false",
    { headers: { "xi-api-key": API_KEY } }
  );

  if (!res.ok) {
    throw new Error(`Failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const voices = data.voices || [];

  console.log(`Total voices available: ${voices.length}\n`);

  // Filter for Australian or matching voices
  const australian = voices.filter((v) => {
    const labels = v.labels || {};
    const desc = (v.description || "").toLowerCase();
    const name = (v.name || "").toLowerCase();
    return (
      labels.accent === "australian" ||
      labels.accent === "Australian" ||
      desc.includes("australian") ||
      desc.includes("aussie") ||
      name.includes("australian")
    );
  });

  if (australian.length > 0) {
    console.log(`Found ${australian.length} Australian voice(s):\n`);
    for (const v of australian) {
      console.log(`  ID: ${v.voice_id}`);
      console.log(`  Name: ${v.name}`);
      console.log(`  Labels: ${JSON.stringify(v.labels)}`);
      console.log(`  Preview: ${v.preview_url || "N/A"}`);
      console.log();
    }
  } else {
    console.log("No Australian voices found in standard library.\n");
    console.log("Showing all available voices with accents:\n");
    
    const withAccent = voices.filter((v) => v.labels?.accent);
    const accents = [...new Set(withAccent.map((v) => v.labels.accent))];
    console.log("Available accents:", accents.join(", "));
    console.log();
    
    // Show some English female voices as alternatives
    const english = voices.filter((v) => {
      const labels = v.labels || {};
      return labels.accent === "british" || labels.accent === "american";
    }).slice(0, 10);
    
    for (const v of english) {
      console.log(`  ${v.voice_id} | ${v.name} | ${JSON.stringify(v.labels)}`);
    }
  }
}

searchVoices().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
