import { text } from "node:stream/consumers";

// Asks questions on the terminal, one line each; hidden answers (passwords) are not echoed.
// Answers can also be piped in, one per line.
export async function prompter() {
  const piped = process.stdin.isTTY ? null : (await text(process.stdin)).split("\n");
  let asked = 0;

  return function ask(question, { hidden = false } = {}) {
    process.stdout.write(question);
    if (piped) {
      process.stdout.write("\n");
      return Promise.resolve((piped[asked++] ?? "").trim());
    }

    return new Promise((resolve) => {
      let answer = "";
      const onKey = (chunk) => {
        for (const key of chunk) {
          if (key === "\r" || key === "\n") {
            process.stdin.off("data", onKey);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write("\n");
            return resolve(answer.trim());
          }
          if (key === "\u0003") process.exit(130); // Ctrl+C
          if (key === "\u007f") {
            if (answer && !hidden) process.stdout.write("\b \b");
            answer = answer.slice(0, -1);
            continue;
          }
          answer += key;
          if (!hidden) process.stdout.write(key);
        }
      };
      process.stdin.setRawMode(true);
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", onKey);
      process.stdin.resume();
    });
  };
}
