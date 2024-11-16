"use client";

import clsx from "clsx";
import { useActionState } from "@/lib/useActionState"; // Ensure this path is correct
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EnterIcon, LoadingIcon } from "@/lib/icons";
import { usePlayer } from "@/lib/usePlayer"; // Ensure this path is correct
import { track } from "@vercel/analytics";
import { useMicVAD, utils } from "@ricky0123/vad-react";

type Message = {
  role: "user" | "assistant";
  content: string;
  latency?: number;
};

export default function Home() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const player = usePlayer();

  const vad = useMicVAD({
    startOnLoad: true,
    onSpeechEnd: (audio) => {
      player.stop();
      const wav = utils.encodeWAV(audio);
      const blob = new Blob([wav], { type: "audio/wav" });
      submit(blob);
      const isFirefox = navigator.userAgent.includes("Firefox");
      if (isFirefox) vad.pause();
    },
    workletURL: "/vad.worklet.bundle.min.js",
    modelURL: "/silero_vad.onnx",
    positiveSpeechThreshold: 0.6,
    minSpeechFrames: 4,
    ortConfig(ort) {
      const isSafari = /^((?!chrome|android).)*safari/i.test(
        navigator.userAgent
      );

      ort.env.wasm = {
        wasmPaths: {
          "ort-wasm-simd-threaded.wasm": "/ort-wasm-simd-threaded.wasm",
          "ort-wasm-simd.wasm": "/ort-wasm-simd.wasm",
          "ort-wasm.wasm": "/ort-wasm.wasm",
          "ort-wasm-threaded.wasm": "/ort-wasm-threaded.wasm",
        },
        numThreads: isSafari ? 1 : 4,
      };
    },
  });

  useEffect(() => {
    function keyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault(); // Prevent form submission if needed
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setInput("");
      }
    }

    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []); // Empty dependency array to add listener only once

  const [messages, submit, isPending] = useActionState<
    Array<Message>,
    string | Blob
  >(async (prevMessages, data) => {
    const formData = new FormData();

    if (typeof data === "string") {
      formData.append("input", data);
      track("Text input");
    } else {
      formData.append("input", data, "audio.wav");
      track("Speech input");
    }

    for (const message of prevMessages) {
      formData.append("message", JSON.stringify(message));
    }

    const submittedAt = Date.now();

    try {
      const response = await fetch("/api/chat", { // Ensure the endpoint matches the server route
        method: "POST",
        body: formData,
      });

      const transcript = decodeURIComponent(
        response.headers.get("X-Transcript") || ""
      );
      const text = decodeURIComponent(
        response.headers.get("X-Response") || ""
      );

      if (!response.ok || !transcript || !text) {
        if (response.status === 429) {
          toast.error("Too many requests. Please try again later.");
        } else {
          const errorMessage = (await response.text()) || "An error occurred.";
          toast.error(errorMessage);
        }
        return prevMessages;
      }

      // Process the audio response
      const audioBlob = await response.blob();
      const audioURL = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioURL);

      // Calculate latency
      const latency = Date.now() - submittedAt;

      // Play the audio and handle VAD after playback
      audio.onended = () => {
        const isFirefox = navigator.userAgent.includes("Firefox");
        if (isFirefox) vad.start();
      };
      audio.play().catch((error) => {
        console.error("Audio playback failed:", error);
        toast.error("Failed to play audio.");
      });

      // Optionally, you can retain the transcript in the input field
      // setInput(transcript);

      return [
        ...prevMessages,
        {
          role: "user",
          content: transcript,
        },
        {
          role: "assistant",
          content: text,
          latency,
        },
      ];
    } catch (error) {
      console.error("Fetch Error:", error);
      toast.error("An unexpected error occurred.");
      return prevMessages;
    }
  }, []);

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim() === "") return;
    submit(input.trim());
    setInput("");
  }

  return (
    <>
      <div className="pb-4 min-h-28" />

      <form
        className="rounded-full bg-neutral-200/80 dark:bg-neutral-800/80 flex items-center w-full max-w-3xl border border-transparent hover:border-neutral-300 focus-within:border-neutral-400 dark:hover:border-neutral-700 dark:focus-within:border-neutral-600 transition-colors duration-200"
        onSubmit={handleFormSubmit}
      >
        <input
          type="text"
          className="bg-transparent focus:outline-none p-4 w-full placeholder:text-neutral-600 dark:placeholder:text-neutral-400"
          required
          placeholder="Ask me anything"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          ref={inputRef}
        />

        <button
          type="submit"
          className="p-4 text-neutral-700 hover:text-black dark:text-neutral-300 dark:hover:text-white transition-colors duration-200"
          disabled={isPending}
          aria-label="Submit"
        >
          {isPending ? <LoadingIcon /> : <EnterIcon />}
        </button>
      </form>

      <div className="text-neutral-400 dark:text-neutral-600 pt-4 text-center max-w-xl text-balance min-h-28 space-y-4">
        {messages.length > 0 && (
          <div>
            <p className="mb-1">
              <strong>User:</strong> {messages[messages.length - 2]?.content}
            </p>
            <p>
              <strong>Assistant:</strong> {messages[messages.length - 1]?.content}
              {messages[messages.length - 1]?.latency && (
                <span className="text-xs font-mono text-neutral-300 dark:text-neutral-700">
                  {" "}
                  ({messages[messages.length - 1]?.latency}ms)
                </span>
              )}
            </p>
          </div>
        )}

        {messages.length === 0 && (
          <>
            <p>
              A fast, open-source voice assistant powered by{" "}
              <A href="https://groq.com">Groq</A>,{" "}
              <A href="https://cartesia.ai">Cartesia</A>,{" "}
              <A href="https://www.vad.ricky0123.com/">VAD</A>, and{" "}
              <A href="https://vercel.com">Vercel</A>.{" "}
              <A
                href="https://github.com/ai-ng/swift"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn more
              </A>
              .
            </p>

            {vad.loading ? (
              <p>Loading speech detection...</p>
            ) : vad.errored ? (
              <p>Failed to load speech detection.</p>
            ) : (
              <p>Start talking to chat.</p>
            )}
          </>
        )}
      </div>

      <div
        className={clsx(
          "absolute size-36 blur-3xl rounded-full bg-gradient-to-b from-red-200 to-red-400 dark:from-red-600 dark:to-red-800 -z-50 transition-opacity duration-500",
          {
            "opacity-0": vad.loading || vad.errored,
            "opacity-30":
              !vad.loading && !vad.errored && !vad.userSpeaking,
            "opacity-100 scale-110": vad.userSpeaking,
          }
        )}
      />
    </>
  );
}

function A(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className="text-neutral-500 dark:text-neutral-500 hover:underline font-medium"
      target={props.target || "_self"}
      rel={props.target === "_blank" ? "noopener noreferrer" : undefined}
    />
  );
}