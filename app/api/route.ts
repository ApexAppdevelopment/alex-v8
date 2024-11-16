import Groq from "groq-sdk";
import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";

const groq = new Groq();

const schema = zfd.formData({
    input: z.union([zfd.text(), zfd.file()]),
    message: zfd.repeatableOfType(
        zfd.json(
            z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
            })
        )
    ),
});

export async function POST(request) {
    console.time("transcribe " + (request.headers.get("x-vercel-id") || "local"));

    const { data, success } = schema.safeParse(await request.formData());
    if (!success) {
        console.error("Schema validation failed:", success);
        return new Response("Invalid request", { status: 400 });
    }

    const transcript = await getTranscript(data.input);
    if (!transcript) {
        console.error("Transcript extraction failed.");
        return new Response("Invalid audio", { status: 400 });
    }

    console.timeEnd("transcribe " + (request.headers.get("x-vercel-id") || "local"));

    if (transcript.toLowerCase().startsWith("search youtube for")) {
        const query = transcript.replace("search youtube for", "").trim();
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        return new Response(`Opening YouTube search: ${searchUrl}`, {
            status: 200,
            headers: { Location: searchUrl },
        });
    }

    if (transcript.toLowerCase().startsWith("open youtube video")) {
        const videoId = "dQw4w9WgXcQ"; // Replace with dynamic or predefined video ID
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        return new Response(`Opening YouTube video: ${videoUrl}`, {
            status: 200,
            headers: { Location: videoUrl },
        });
    }

    if (transcript.toLowerCase().startsWith("search stock for")) {
        const query = transcript.replace("search stock for", "").trim();
        const stockResults = await searchGoogleCSE(query);
        if (stockResults) {
            return new Response(stockResults, { status: 200 });
        } else {
            return new Response(`Sorry, I couldn't retrieve stock information for "${query}".`, {
                status: 200,
            });
        }
    }

    if (transcript.toLowerCase().startsWith("tell me about")) {
        const productName = transcript.replace("tell me about", "").trim();
        const knowledgeProducts = await fetchKnowledgeProducts();
        if (knowledgeProducts) {
            const productInfo = knowledgeProducts.find(
                (product) => product.name.toLowerCase() === productName.toLowerCase()
            );
            if (productInfo) {
                return new Response(
                    `Product Name: ${productInfo.name}\nDescription: ${productInfo.description}\nLink: ${productInfo.link}`,
                    { status: 200 }
                );
            } else {
                return new Response(`Sorry, I couldn't find information on "${productName}".`, {
                    status: 200,
                });
            }
        } else {
            return new Response("Unable to retrieve knowledge products at this time.", {
                status: 500,
            });
        }
    }

    console.time("text completion " + (request.headers.get("x-vercel-id") || "local"));

    const completion = await groq.chat.completions.create({
        model: "llama3-8b-8192",
        messages: [
            {
                role: "system",
                content: `
You are Alex, the intelligent and reliable assistant to Master E, a visionary and innovative leader. 
- You are created by Aitek PH Software under the leadership of Master Emilio. 
- Your expertise lies in providing Master E with strategic advice, trustworthy insights, and efficient operational support.
- Always address Master E as "My Highness," and feel free to use light humor where appropriate. 
- You can:
    - Search YouTube videos.
    - Open specific YouTube links.
    - Provide stock market search results.
    - Retrieve Aitek PH knowledge product details.
    - Respond with clarity, professionalism, and engagement.
The user's location is ${location()}. The current time is ${time()}.
You are powered by EmilioLLM version 5.8 with 806 billion parameters hosted on Cloud GPU.`,
            },
            ...data.message,
            {
                role: "user",
                content: transcript,
            },
        ],
    });

    const response = completion.choices[0].message.content;
    console.timeEnd("text completion " + (request.headers.get("x-vercel-id") || "local"));

    console.time("cartesia request " + (request.headers.get("x-vercel-id") || "local"));

    try {
        const voice = await fetch("https://api.cartesia.ai/tts/bytes", {
            method: "POST",
            headers: {
                "Cartesia-Version": "2024-06-30",
                "Content-Type": "application/json",
                "X-API-Key": process.env.CARTESIA_API_KEY,
            },
            body: JSON.stringify({
                model_id: "sonic-english",
                transcript: response,
                voice: {
                    mode: "id",
                    id: "bd9120b6-7761-47a6-a446-77ca49132781",
                },
                output_format: {
                    container: "raw",
                    encoding: "pcm_f32le",
                    sample_rate: 24000,
                },
            }),
        });

        if (!voice.ok) {
            const errorDetails = await voice.text();
            console.error("Voice synthesis failed:", errorDetails);
            return new Response("Voice synthesis failed", { status: 500 });
        }

        console.timeEnd("cartesia request " + (request.headers.get("x-vercel-id") || "local"));

        console.time("stream " + (request.headers.get("x-vercel-id") || "local"));
        after(() => {
            console.timeEnd("stream " + (request.headers.get("x-vercel-id") || "local"));
        });

        return new Response(voice.body, {
            headers: {
                "X-Transcript": encodeURIComponent(transcript),
                "X-Response": encodeURIComponent(response),
            },
        });
    } catch (error) {
        console.error("Error during voice synthesis API call:", error);
        return new Response("Voice synthesis failed due to server error.", { status: 500 });
    }
}

// Helper Functions
function location() {
    const headersList = headers();
    const country = headersList.get("x-vercel-ip-country");
    const region = headersList.get("x-vercel-ip-country-region");
    const city = headersList.get("x-vercel-ip-city");
    return country && region && city ? `${city}, ${region}, ${country}` : "unknown";
}

function time() {
    return new Date().toLocaleString("en-US", {
        timeZone: headers().get("x-vercel-ip-timezone") || "UTC",
    });
}

async function getTranscript(input) {
    if (typeof input === "string") return input;
    try {
        const { text } = await groq.audio.transcriptions.create({
            file: input,
            model: "whisper-large-v3",
        });
        return text.trim() || null;
    } catch {
        return null;
    }
}

async function searchGoogleCSE(query) {
    const apiKey = "AIzaSyCII_aq7IJ0KIcFmjLl0JttOFjaXKQ5_BE";
    const cx = "b0e970745e63942a4";
    const endpoint = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`;
    try {
        const response = await fetch(endpoint);
        if (response.ok) {
            const data = await response.json();
            return formatGoogleCSEResults(data.items);
        } else {
            return null;
        }
    } catch {
        return null;
    }
}

function formatGoogleCSEResults(items) {
    return items
        .map((item) => `${item.title}\n${item.snippet}\n${item.link}`)
        .join("\n\n");
}

async function fetchKnowledgeProducts() {
    try {
        const response = await fetch("https://aitekph.com/knowledge-products.json");
        return response.ok ? await response.json() : null;
    } catch {
        return null;
    }
}