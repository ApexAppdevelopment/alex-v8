import { z } from "zod";
import { zfd } from "zod-form-data";
import { headers } from "next/headers";
import { unstable_after as after } from "next/server";

// Define environment variables for API keys
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY!;
const TOGETHERAI_API_KEY = process.env.TOGETHERAI_API_KEY!;
const NEETS_API_KEY = process.env.NEETS_API_KEY!;

// Define the schema for form data validation
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

export async function POST(request: Request) {
  const vercelId = request.headers.get("x-vercel-id") || "local";
  console.time(`transcribe ${vercelId}`);

  const { data, success } = schema.safeParse(await request.formData());
  if (!success) return new Response("Invalid request", { status: 400 });

  const transcript = await getTranscript(data.input);
  if (!transcript) return new Response("Invalid audio", { status: 400 });

  console.timeEnd(`transcribe ${vercelId}`);
  console.time(`chat completion ${vercelId}`);

  const completion = await getChatCompletion(data.message, transcript);
  if (!completion) return new Response("Chat completion failed", { status: 500 });

  console.timeEnd(`chat completion ${vercelId}`);
  console.time(`tts request ${vercelId}`);

  const voice = await getTTS(completion);
  if (!voice) return new Response("Voice synthesis failed", { status: 500 });

  console.timeEnd(`tts request ${vercelId}`);
  console.time(`stream ${vercelId}`);

  after(() => {
    console.timeEnd(`stream ${vercelId}`);
  });

  return new Response(voice, {
    headers: {
      "Content-Type": "audio/mpeg", // Adjust based on Neets.ai's output format
      "X-Transcript": encodeURIComponent(transcript),
      "X-Response": encodeURIComponent(completion),
    },
  });
}

// Function to retrieve location from headers
function location() {
  const headersList = headers();

  const country = headersList.get("x-vercel-ip-country");
  const region = headersList.get("x-vercel-ip-country-region");
  const city = headersList.get("x-vercel-ip-city");

  if (!country || !region || !city) return "unknown";

  return `${city}, ${region}, ${country}`;
}

// Function to retrieve current time based on timezone
function time() {
  return new Date().toLocaleString("en-US", {
    timeZone: headers().get("x-vercel-ip-timezone") || undefined,
  });
}

// Function to handle Speech-to-Text using Deepgram
async function getTranscript(input: string | File): Promise<string | null> {
  if (typeof input === "string") return input;

  try {
    const formData = new FormData();
    formData.append("file", input);
    // If you prefer to use a URL instead of uploading the file, modify accordingly.

    const response = await fetch(
      "https://api.deepgram.com/v1/listen?smart_format=true&detect_language=true&model=whisper-medium",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          // 'Content-Type' is automatically set to 'multipart/form-data' when using FormData
        },
        body: formData,
      }
    );

    if (!response.ok) {
      console.error("Deepgram STT Error:", await response.text());
      return null;
    }

    const result = await response.json();
    return result.results.channels[0].alternatives[0].transcript.trim() || null;
  } catch (error) {
    console.error("Deepgram STT Exception:", error);
    return null;
  }
}

// Function to handle Chat Completion using TogetherAI
async function getChatCompletion(
  previousMessages: Array<{ role: string; content: string }>,
  userTranscript: string
): Promise<string | null> {
  try {
    const payload = {
      model: "meta-llama/Meta-Llama-3-70B-Instruct-Lite", // As per your curl example
      messages: [
        {
          role: "system",
          content: `You are Alex, the intelligent and reliable trustee assistant of Master E, a visionary and innovative leader.
- Created by Aitek PH Software, under the leadership of Master Emilio.
- You specialize in providing Master E with strategic advice, trustworthy insights, and efficient support in managing daily operations and high-level decision-making.
- Respond to users with professionalism, clarity, and a tone that reflects a deep understanding of leadership, strategy, and trust.
- Focus on offering precise, actionable advice while demonstrating a thoughtful and analytical approach to problem-solving.
- When addressing users, ensure a balanced tone of respect and authority, avoiding unnecessary complexity or unrelated details.
- Utilize your extensive knowledge in business management, innovation, and leadership principles to assist in any task or query.
- Avoid using emojis, unnecessary formatting, or overly casual language to maintain a professional demeanor.
- User location is ${location()}.
- The current time is ${time()}.
- Your large language model is EmilioLLM version 5.8, an 806 billion parameter version hosted on Cloud GPU, tailored for intelligent and strategic interactions.
- Your text-to-speech system is Emilio Sonic, delivering clear and confident voice output.
- You are optimized for high-level decision-making and trusted support, ensuring Master E's goals are met with precision and integrity.`,
        },
        ...previousMessages,
        {
          role: "user",
          content: userTranscript,
        },
      ],
      max_tokens: 4000,
      temperature: 0.7,
      top_p: 0.7,
      top_k: 73,
      repetition_penalty: 1,
      stop: ["<|eot_id|>"],
      update_at: new Date().toISOString(),
      stream: false, // Set to true if you want to handle streaming responses
    };

    const response = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOGETHERAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("TogetherAI Chat Completion Error:", await response.text());
      return null;
    }

    const result = await response.json();
    return result.choices[0].message.content;
  } catch (error) {
    console.error("TogetherAI Chat Completion Exception:", error);
    return null;
  }
}

// Function to handle Text-to-Speech using Neets.ai
async function getTTS(text: string): Promise<Uint8Array | null> {
  try {
    const payload = {
      text: text,
      voice_id: "us-male-2", // As per your fetch example
      params: {
        model: "style-diff-500",
      },
    };

    const response = await fetch("https://api.neets.ai/v1/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": NEETS_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error("Neets.ai TTS Error:", await response.text());
      return null;
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    console.error("Neets.ai TTS Exception:", error);
    return null;
  }
}