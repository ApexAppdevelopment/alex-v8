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

export async function POST(request: Request) {
  console.time("transcribe " + request.headers.get("x-vercel-id") || "local");

  const { data, success } = schema.safeParse(await request.formData());
  if (!success) return new Response("Invalid request", { status: 400 });

  const transcript = await getTranscript(data.input);
  if (!transcript) return new Response("Invalid audio", { status: 400 });

  console.timeEnd(
    "transcribe " + request.headers.get("x-vercel-id") || "local"
  );
  console.time(
    "text completion " + request.headers.get("x-vercel-id") || "local"
  );

  const completion = await groq.chat.completions.create({
    model: "llama3-8b-8192",
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
      ...data.message,
      {
        role: "user",
        content: transcript,
      },
    ],
  });

  const response = completion.choices[0].message.content;
  console.timeEnd(
    "text completion " + request.headers.get("x-vercel-id") || "local"
  );

  console.time(
    "cartesia request " + request.headers.get("x-vercel-id") || "local"
  );

  const voice = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "Cartesia-Version": "2024-06-30",
      "Content-Type": "application/json",
      "X-API-Key": process.env.CARTESIA_API_KEY!,
    },
    body: JSON.stringify({
      model_id: "sonic-english",
      transcript: response,
      voice: {
        mode: "id",
        id: "79a125e8-cd45-4c13-8a67-188112f4dd22",
      },
      output_format: {
        container: "raw",
        encoding: "pcm_f32le",
        sample_rate: 24000,
      },
    }),
  });

  console.timeEnd(
    "cartesia request " + request.headers.get("x-vercel-id") || "local"
  );

  if (!voice.ok) {
    console.error(await voice.text());
    return new Response("Voice synthesis failed", { status: 500 });
  }

  console.time("stream " + request.headers.get("x-vercel-id") || "local");
  after(() => {
    console.timeEnd(
      "stream " + request.headers.get("x-vercel-id") || "local"
    );
  });

  return new Response(voice.body, {
    headers: {
      "X-Transcript": encodeURIComponent(transcript),
      "X-Response": encodeURIComponent(response),
    },
  });
}

function location() {
  const headersList = headers();

  const country = headersList.get("x-vercel-ip-country");
  const region = headersList.get("x-vercel-ip-country-region");
  const city = headersList.get("x-vercel-ip-city");

  if (!country || !region || !city) return "unknown";

  return `${city}, ${region}, ${country}`;
}

function time() {
  return new Date().toLocaleString("en-US", {
    timeZone: headers().get("x-vercel-ip-timezone") || undefined,
  });
}

async function getTranscript(input: string | File) {
  if (typeof input === "string") return input;

  try {
    const { text } = await groq.audio.transcriptions.create({
      file: input,
      model: "whisper-large-v3",
    });

    return text.trim() || null;
  } catch {
    return null; // Empty audio file
  }
}