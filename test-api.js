import fs from 'fs';
const env = JSON.parse(fs.readFileSync('./env.json'));
const apiKey = env.GEMINI_API_KEY;

const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=' + apiKey;
const bodyPayload = JSON.stringify({
    contents: [{ parts: [{ text: 'Return ONLY valid JSON. {"projects": []} \n\n TABS TO ANALYZE:\n TAB 1:\n URL: https://github.com/test\n' }] }]
});

fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyPayload
})
    .then(res => res.json())
    .then(data => {
        if (data.error) {
            console.error('API Error:', data.error.message);
            process.exit(1);
        } else {
            console.log('API call successful!', data.candidates[0].content.parts[0].text);
        }
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
