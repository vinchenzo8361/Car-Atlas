const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { finished } = require('stream/promises');

const dir = path.join(__dirname, 'public', 'images', 'logos');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

const logos = {
  "Porsche": "https://cdn.worldvectorlogo.com/logos/porsche-6.svg",
  "McLaren": "https://cdn.worldvectorlogo.com/logos/mclaren-4.svg",
  "Ferrari": "https://cdn.worldvectorlogo.com/logos/ferrari-ges.svg",
  "Lamborghini": "https://cdn.worldvectorlogo.com/logos/lamborghini-1.svg",
  "Audi": "https://cdn.worldvectorlogo.com/logos/audi-11.svg",
  "Bugatti": "https://cdn.worldvectorlogo.com/logos/bugatti-logo.svg",
  "Nissan": "https://cdn.worldvectorlogo.com/logos/nissan-6.svg",
  "BMW": "https://cdn.worldvectorlogo.com/logos/bmw.svg",
  "Mercedes": "https://cdn.worldvectorlogo.com/logos/mercedes-benz-9.svg",
  "Koenigsegg": "https://cdn.worldvectorlogo.com/logos/koenigsegg.svg",
  "Aston Martin": "https://cdn.worldvectorlogo.com/logos/aston-martin-1.svg",
  "Chevrolet": "https://cdn.worldvectorlogo.com/logos/chevrolet-1.svg",
  "Toyota": "https://cdn.worldvectorlogo.com/logos/toyota.svg",
  "Dodge": "https://cdn.worldvectorlogo.com/logos/dodge-2.svg",
  "Formula 1": "https://cdn.worldvectorlogo.com/logos/f1-2.svg"
};

async function download() {
    for (const [name, url] of Object.entries(logos)) {
        try {
            console.log(`Fetching ${name}...`);
            const res = await fetch(url, { redirect: 'follow' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const dest = path.join(dir, `${name.toLowerCase().replace(' ', '')}.svg`);
            
            // Allow overwriting by removing the wx flag
            const fileStream = fs.createWriteStream(dest);
            await finished(Readable.fromWeb(res.body).pipe(fileStream));
            console.log(`Saved ${name}`);
        } catch (e) {
            console.error(`Error saving ${name}: ${e.message}`);
        }
    }
}
download();
